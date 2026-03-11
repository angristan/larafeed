package service

import (
	"context"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/angristan/larafeed-go/internal/db"
)

const brightnessThreshold = 80

type FaviconService struct {
	q        *db.Queries
	imgProxy *ImgProxyService
}

func NewFaviconService(q *db.Queries, imgProxy *ImgProxyService) *FaviconService {
	return &FaviconService{q: q, imgProxy: imgProxy}
}

// GetFaviconURL attempts to find the favicon URL for a site.
func (s *FaviconService) GetFaviconURL(ctx context.Context, siteURL string) string {
	u, err := url.Parse(siteURL)
	if err != nil {
		return ""
	}

	// Try common favicon locations
	candidates := []string{
		fmt.Sprintf("%s://%s/favicon.ico", u.Scheme, u.Host),
		fmt.Sprintf("%s://%s/favicon.png", u.Scheme, u.Host),
		fmt.Sprintf("%s://%s/apple-touch-icon.png", u.Scheme, u.Host),
	}

	client := &http.Client{
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}

	for _, candidate := range candidates {
		if err := ValidateURL(candidate); err != nil {
			continue
		}
		req, err := http.NewRequestWithContext(ctx, "HEAD", candidate, nil)
		if err != nil {
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		resp.Body.Close()

		if resp.StatusCode == 200 {
			ct := resp.Header.Get("Content-Type")
			if strings.Contains(ct, "image") || strings.Contains(ct, "icon") || ct == "" {
				return candidate
			}
		}
	}

	return ""
}

// AnalyzeBrightness determines if a favicon is dark (for dark mode backgrounds).
// Uses imgproxy to resize to 10x10 PNG, then calculates weighted average brightness.
func (s *FaviconService) AnalyzeBrightness(ctx context.Context, faviconURL string) *bool {
	if faviconURL == "" {
		return nil
	}

	// Use imgproxy to resize to 10x10 PNG for consistent analysis
	fetchURL := faviconURL
	if s.imgProxy.Enabled() {
		fetchURL = s.imgProxy.ProxifyFaviconForAnalysis(faviconURL)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", fetchURL, nil)
	if err != nil {
		return nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		slog.Warn("Failed to fetch favicon for brightness analysis",
			"favicon_url", faviconURL, "status", resp.StatusCode)
		return nil
	}

	img, _, err := image.Decode(resp.Body)
	if err != nil {
		return nil
	}

	bounds := img.Bounds()
	var totalBrightness float64
	var totalWeight float64

	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			c := img.At(x, y)

			// Convert to NRGBA to get non-premultiplied 0-255 values,
			// matching PHP GD's imagecolorat() behavior.
			nrgba := color.NRGBAModel.Convert(c).(color.NRGBA)

			// Alpha: 0=transparent, 255=opaque (GD uses 0=opaque, 127=transparent)
			if nrgba.A == 0 {
				continue
			}

			// Opacity: 0.0 to 1.0
			opacity := float64(nrgba.A) / 255.0

			// Perceived brightness using luminance formula on 0-255 RGB values
			brightness := 0.299*float64(nrgba.R) + 0.587*float64(nrgba.G) + 0.114*float64(nrgba.B)

			totalBrightness += brightness * opacity
			totalWeight += opacity
		}
	}

	if totalWeight < 0.001 {
		return nil
	}

	avgBrightness := totalBrightness / totalWeight
	isDark := avgBrightness < brightnessThreshold
	return &isDark
}

// RefreshFavicon fetches and analyzes a feed's favicon.
func (s *FaviconService) RefreshFavicon(ctx context.Context, feed *db.Feed) error {
	faviconURL := s.GetFaviconURL(ctx, feed.SiteURL)
	var faviconPtr *string
	if faviconURL != "" {
		faviconPtr = &faviconURL
	}

	isDark := s.AnalyzeBrightness(ctx, faviconURL)
	return s.q.UpdateFeedFavicon(ctx, db.UpdateFeedFaviconParams{ID: feed.ID, FaviconURL: faviconPtr, FaviconIsDark: isDark})
}

// BuildProxifiedFaviconURL returns a proxified favicon URL.
func (s *FaviconService) BuildProxifiedFaviconURL(faviconURL *string) string {
	if faviconURL == nil || *faviconURL == "" {
		return "/rss.svg"
	}
	return s.imgProxy.ProxifyFaviconURL(*faviconURL)
}

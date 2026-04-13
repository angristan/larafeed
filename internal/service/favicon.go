package service

import (
	"context"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const brightnessThreshold = 80

type FaviconService struct {
	q        db.Querier
	imgProxy *ImgProxyService
}

func NewFaviconService(q db.Querier, imgProxy *ImgProxyService) *FaviconService {
	return &FaviconService{q: q, imgProxy: imgProxy}
}

// GetFaviconURL attempts to find the favicon URL for a site.
func (s *FaviconService) GetFaviconURL(ctx context.Context, siteURL string) string {
	u, err := url.Parse(siteURL)
	if err != nil {
		return ""
	}

	client := safeHTTPClient()
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	}

	candidates := s.fetchFaviconCandidatesFromHTML(ctx, client, siteURL)
	if faviconURL := probeFaviconCandidates(ctx, client, candidates); faviconURL != "" {
		return faviconURL
	}

	return probeFaviconCandidates(ctx, client, []string{
		fmt.Sprintf("%s://%s/favicon.ico", u.Scheme, u.Host),
		fmt.Sprintf("%s://%s/favicon.png", u.Scheme, u.Host),
		fmt.Sprintf("%s://%s/apple-touch-icon.png", u.Scheme, u.Host),
	})
}

func (s *FaviconService) fetchFaviconCandidatesFromHTML(ctx context.Context, client *http.Client, siteURL string) []string {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, siteURL, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Larafeed/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer func() {
		closeErr := resp.Body.Close()
		if closeErr != nil {
			slog.WarnContext(ctx, "failed to close response body", "error", closeErr)
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil
	}

	pageURL := siteURL
	if resp.Request != nil && resp.Request.URL != nil {
		pageURL = resp.Request.URL.String()
	}

	return discoverFaviconsFromHTML(pageURL, string(body))
}

func probeFaviconCandidates(ctx context.Context, client *http.Client, candidates []string) string {
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if faviconCandidateReachable(ctx, client, candidate) {
			return candidate
		}
	}
	return ""
}

func faviconCandidateReachable(ctx context.Context, client *http.Client, faviconURL string) bool {
	for _, method := range []string{http.MethodHead, http.MethodGet} {
		req, err := http.NewRequestWithContext(ctx, method, faviconURL, nil)
		if err != nil {
			continue
		}
		req.Header.Set("User-Agent", "Larafeed/1.0")

		resp, err := client.Do(req)
		if err != nil {
			continue
		}

		closeErr := resp.Body.Close()
		if closeErr != nil {
			slog.WarnContext(ctx, "failed to close response body", "error", closeErr)
		}

		if resp.StatusCode != http.StatusOK {
			continue
		}

		ct := strings.ToLower(resp.Header.Get("Content-Type"))
		if strings.Contains(ct, "image") || strings.Contains(ct, "icon") || ct == "" {
			return true
		}
	}

	return false
}

type rankedFavicon struct {
	url   string
	score int
}

func discoverFaviconsFromHTML(pageURL, body string) []string {
	if pageURL == "" || body == "" {
		return nil
	}

	base, err := url.Parse(pageURL)
	if err != nil {
		return nil
	}

	doc, err := html.Parse(strings.NewReader(body))
	if err != nil {
		return nil
	}

	var candidates []rankedFavicon
	seen := make(map[string]struct{})

	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && n.DataAtom == atom.Link {
			href := strings.TrimSpace(nodeAttr(n, "href"))
			score, ok := faviconLinkScore(nodeAttr(n, "rel"), nodeAttr(n, "sizes"), nodeAttr(n, "type"))
			if ok && href != "" {
				ref, err := url.Parse(href)
				if err == nil {
					resolved := base.ResolveReference(ref).String()
					if validateScheme(resolved) == nil {
						if _, exists := seen[resolved]; !exists {
							candidates = append(candidates, rankedFavicon{url: resolved, score: score})
							seen[resolved] = struct{}{}
						}
					}
				}
			}
		}

		for child := n.FirstChild; child != nil; child = child.NextSibling {
			walk(child)
		}
	}

	walk(doc)

	sort.SliceStable(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})

	urls := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		urls = append(urls, candidate.url)
	}

	return urls
}

func faviconLinkScore(rel, sizes, typeAttr string) (int, bool) {
	tokens := strings.Fields(strings.ToLower(rel))
	if len(tokens) == 0 {
		return 0, false
	}

	hasIcon := false
	hasShortcut := false
	hasAppleTouchIcon := false

	for _, token := range tokens {
		switch token {
		case "icon":
			hasIcon = true
		case "shortcut":
			hasShortcut = true
		case "apple-touch-icon", "apple-touch-icon-precomposed":
			hasAppleTouchIcon = true
		}
	}

	if !hasIcon && !hasAppleTouchIcon {
		return 0, false
	}

	score := 0
	if hasIcon {
		score += 300
	}
	if hasShortcut && hasIcon {
		score += 20
	}
	if hasAppleTouchIcon {
		score += 200
	}

	typeAttr = strings.ToLower(strings.TrimSpace(typeAttr))
	switch {
	case strings.Contains(typeAttr, "png"):
		score += 30
	case strings.Contains(typeAttr, "icon"):
		score += 25
	case strings.Contains(typeAttr, "svg"):
		score += 10
	}

	score += faviconSizesScore(sizes)
	return score, true
}

func faviconSizesScore(sizes string) int {
	sizes = strings.ToLower(strings.TrimSpace(sizes))
	if sizes == "" {
		return 0
	}
	if sizes == "any" {
		return 5
	}

	best := 0
	for _, size := range strings.Fields(sizes) {
		parts := strings.Split(size, "x")
		if len(parts) != 2 {
			continue
		}

		width, err := strconv.Atoi(parts[0])
		if err != nil {
			continue
		}
		height, err := strconv.Atoi(parts[1])
		if err != nil || width != height || width <= 0 {
			continue
		}

		score := 64 - abs(width-32)
		if score < 0 {
			score = 0
		}
		if score > best {
			best = score
		}
	}

	return best
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func nodeAttr(n *html.Node, key string) string {
	for _, attr := range n.Attr {
		if strings.EqualFold(attr.Key, key) {
			return attr.Val
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
	defer func() {
		closeErr := resp.Body.Close()
		if closeErr != nil {
			slog.WarnContext(ctx, "failed to close response body", "error", closeErr)
		}
	}()

	if resp.StatusCode != 200 {
		slog.WarnContext(ctx, "Failed to fetch favicon for brightness analysis",
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
	// Bound the entire operation (up to 3 HEAD probes + 1 GET for brightness).
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

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

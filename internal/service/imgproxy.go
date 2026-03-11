package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
)

type ImgProxyService struct {
	url  string
	key  []byte
	salt []byte
}

func NewImgProxyService(proxyURL, keyHex, saltHex string) *ImgProxyService {
	key, _ := hex.DecodeString(keyHex)
	salt, _ := hex.DecodeString(saltHex)
	return &ImgProxyService{url: proxyURL, key: key, salt: salt}
}

func (s *ImgProxyService) Enabled() bool {
	return s.url != "" && len(s.key) > 0
}

// ProxifyFaviconURL returns a proxified favicon URL (32x32, 2x DPR, webp).
func (s *ImgProxyService) ProxifyFaviconURL(originalURL string) string {
	if !s.Enabled() || originalURL == "" {
		return originalURL
	}
	return s.buildURL("rs:fill:32:32/dpr:2/f:webp", originalURL)
}

// ProxifyContentImage returns a proxified URL for content images.
func (s *ImgProxyService) ProxifyContentImage(originalURL string) string {
	if !s.Enabled() || originalURL == "" {
		return originalURL
	}
	return s.buildURL("f:webp", originalURL)
}

// ProxifyImagesInHTML replaces img src URLs in HTML content with proxified versions.
func (s *ImgProxyService) ProxifyImagesInHTML(html string) string {
	if !s.Enabled() || html == "" {
		return html
	}

	// Replace img src attributes
	imgSrcRe := regexp.MustCompile(`(<img[^>]+src=")([^"]+)(")`)
	html = imgSrcRe.ReplaceAllStringFunc(html, func(match string) string {
		groups := imgSrcRe.FindStringSubmatch(match)
		if len(groups) < 4 {
			return match
		}
		proxied := s.ProxifyContentImage(groups[2])
		return groups[1] + proxied + groups[3]
	})

	// Replace img srcset attributes
	srcsetRe := regexp.MustCompile(`(<(?:img|source)[^>]+srcset=")([^"]+)(")`)
	html = srcsetRe.ReplaceAllStringFunc(html, func(match string) string {
		groups := srcsetRe.FindStringSubmatch(match)
		if len(groups) < 4 {
			return match
		}
		srcset := groups[2]
		parts := strings.Split(srcset, ",")
		for i, part := range parts {
			part = strings.TrimSpace(part)
			fields := strings.Fields(part)
			if len(fields) >= 1 {
				fields[0] = s.ProxifyContentImage(fields[0])
				parts[i] = strings.Join(fields, " ")
			}
		}
		return groups[1] + strings.Join(parts, ", ") + groups[3]
	})

	return html
}

func (s *ImgProxyService) buildURL(processing, sourceURL string) string {
	encodedURL := base64.RawURLEncoding.EncodeToString([]byte(sourceURL))
	path := fmt.Sprintf("/%s/%s", processing, encodedURL)

	mac := hmac.New(sha256.New, s.key)
	mac.Write(s.salt)
	mac.Write([]byte(path))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("%s/%s%s", s.url, signature, path)
}

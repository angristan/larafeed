package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

type ImgProxyService struct {
	url  string
	key  []byte
	salt []byte
}

func NewImgProxyService(proxyURL, keyHex, saltHex string) (*ImgProxyService, error) {
	key, err := hex.DecodeString(keyHex)
	if err != nil {
		return nil, fmt.Errorf("decode imgproxy key: %w", err)
	}
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil, fmt.Errorf("decode imgproxy salt: %w", err)
	}
	return &ImgProxyService{url: proxyURL, key: key, salt: salt}, nil
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

// ProxifyFaviconForAnalysis returns a proxified URL resized to 10x10 PNG for brightness analysis.
func (s *ImgProxyService) ProxifyFaviconForAnalysis(originalURL string) string {
	if !s.Enabled() || originalURL == "" {
		return originalURL
	}
	return s.buildURL("rs:force:10:10/f:png", originalURL)
}

// ProxifyContentImage returns a proxified URL for content images.
func (s *ImgProxyService) ProxifyContentImage(originalURL string) string {
	if !s.Enabled() || originalURL == "" {
		return originalURL
	}
	return s.buildURL("f:webp", originalURL)
}

// ProxifyImagesInHTML replaces img src/srcset and picture>source srcset URLs
// in HTML content with proxified versions, using DOM parsing.
func (s *ImgProxyService) ProxifyImagesInHTML(htmlContent string) string {
	if !s.Enabled() || htmlContent == "" {
		return htmlContent
	}

	// Parse the HTML fragment
	nodes, err := html.ParseFragment(strings.NewReader(htmlContent), &html.Node{
		Type:     html.ElementNode,
		DataAtom: atom.Body,
		Data:     "body",
	})
	if err != nil || len(nodes) == 0 {
		return htmlContent
	}

	// Walk all nodes and proxify img src/srcset and source srcset
	for _, n := range nodes {
		s.walkAndProxify(n)
	}

	// Render back to HTML
	var buf bytes.Buffer
	for _, n := range nodes {
		err := html.Render(&buf, n)
		if err != nil {
			return htmlContent
		}
	}

	return buf.String()
}

func (s *ImgProxyService) walkAndProxify(n *html.Node) {
	if n.Type == html.ElementNode {
		switch n.DataAtom {
		case atom.Img:
			s.proxifyAttr(n, "src", false)
			s.proxifyAttr(n, "srcset", true)
		case atom.Source:
			s.proxifyAttr(n, "srcset", true)
		}
	}

	for c := n.FirstChild; c != nil; c = c.NextSibling {
		s.walkAndProxify(c)
	}
}

func (s *ImgProxyService) proxifyAttr(n *html.Node, attrName string, isSrcset bool) {
	for i, a := range n.Attr {
		if a.Key != attrName || a.Val == "" {
			continue
		}
		if isSrcset {
			n.Attr[i].Val = s.proxifySrcset(a.Val)
		} else {
			n.Attr[i].Val = s.ProxifyContentImage(a.Val)
		}
		return
	}
}

func (s *ImgProxyService) proxifySrcset(srcset string) string {
	parts := strings.Split(srcset, ",")
	for i, part := range parts {
		part = strings.TrimSpace(part)
		fields := strings.Fields(part)
		if len(fields) >= 1 {
			fields[0] = s.ProxifyContentImage(fields[0])
			parts[i] = strings.Join(fields, " ")
		}
	}
	return strings.Join(parts, ", ")
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

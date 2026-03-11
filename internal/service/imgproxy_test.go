package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestProxifyImagesInHTML(t *testing.T) {
	// Create a service with dummy keys (so Enabled() returns true)
	svc := NewImgProxyService("https://imgproxy.example.com", "0123456789abcdef", "fedcba9876543210")

	t.Run("proxifies img src", func(t *testing.T) {
		html := `<p>Hello</p><img src="https://example.com/photo.jpg" alt="test">`
		result := svc.ProxifyImagesInHTML(html)
		assert.NotContains(t, result, "https://example.com/photo.jpg")
		assert.Contains(t, result, "imgproxy.example.com")
		assert.Contains(t, result, `alt="test"`)
	})

	t.Run("proxifies img srcset", func(t *testing.T) {
		html := `<img srcset="https://example.com/small.jpg 1x, https://example.com/large.jpg 2x">`
		result := svc.ProxifyImagesInHTML(html)
		assert.NotContains(t, result, "https://example.com/small.jpg")
		assert.NotContains(t, result, "https://example.com/large.jpg")
		assert.Contains(t, result, "1x")
		assert.Contains(t, result, "2x")
	})

	t.Run("proxifies picture source srcset", func(t *testing.T) {
		html := `<picture><source srcset="https://example.com/img.webp" type="image/webp"><img src="https://example.com/img.jpg"></picture>`
		result := svc.ProxifyImagesInHTML(html)
		assert.NotContains(t, result, "https://example.com/img.webp")
		assert.NotContains(t, result, "https://example.com/img.jpg")
		// Both should be proxified
		assert.Equal(t, 2, strings.Count(result, "imgproxy.example.com"))
	})

	t.Run("preserves non-image elements", func(t *testing.T) {
		html := `<p>Hello <strong>world</strong></p><a href="https://example.com">link</a>`
		result := svc.ProxifyImagesInHTML(html)
		assert.Contains(t, result, "<p>Hello <strong>world</strong></p>")
		assert.Contains(t, result, `href="https://example.com"`)
	})

	t.Run("returns empty string unchanged", func(t *testing.T) {
		assert.Equal(t, "", svc.ProxifyImagesInHTML(""))
	})

	t.Run("returns original when disabled", func(t *testing.T) {
		disabled := NewImgProxyService("", "", "")
		html := `<img src="https://example.com/photo.jpg">`
		assert.Equal(t, html, disabled.ProxifyImagesInHTML(html))
	})
}

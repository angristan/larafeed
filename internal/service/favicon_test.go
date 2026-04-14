package service

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func createTestPNG(t *testing.T, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 10, 10))
	for y := 0; y < 10; y++ {
		for x := 0; x < 10; x++ {
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func TestBuildProxifiedFaviconURL(t *testing.T) {
	t.Run("returns /rss.svg when URL is nil", func(t *testing.T) {
		imgProxy, err := NewImgProxyService("", "", "")
		require.NoError(t, err)
		svc := NewFaviconService(nil, imgProxy)
		assert.Equal(t, "/rss.svg", svc.BuildProxifiedFaviconURL(nil))
	})

	t.Run("returns /rss.svg when URL is empty", func(t *testing.T) {
		imgProxy, err := NewImgProxyService("", "", "")
		require.NoError(t, err)
		svc := NewFaviconService(nil, imgProxy)
		empty := ""
		assert.Equal(t, "/rss.svg", svc.BuildProxifiedFaviconURL(&empty))
	})

	t.Run("returns original URL when proxy is disabled", func(t *testing.T) {
		imgProxy, err := NewImgProxyService("", "", "")
		require.NoError(t, err)
		svc := NewFaviconService(nil, imgProxy)
		url := "https://example.com/favicon.ico"
		assert.Equal(t, "https://example.com/favicon.ico", svc.BuildProxifiedFaviconURL(&url))
	})

	t.Run("returns proxified URL when proxy is enabled", func(t *testing.T) {
		// "secret" and "salt" in hex
		imgProxy, err := NewImgProxyService("https://imgproxy.example.com", "736563726574", "73616c74")
		require.NoError(t, err)
		svc := NewFaviconService(nil, imgProxy)
		url := "https://example.com/favicon.ico"
		result := svc.BuildProxifiedFaviconURL(&url)
		assert.Contains(t, result, "imgproxy.example.com")
		assert.NotEqual(t, url, result)
	})
}

func TestAnalyzeBrightness_DarkImage(t *testing.T) {
	blackPNG := createTestPNG(t, color.Black)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		_, err := w.Write(blackPNG)
		if err != nil {
			t.Errorf("failed to write test response: %v", err)
		}
	}))
	defer server.Close()

	imgProxy, err := NewImgProxyService("", "", "")
	require.NoError(t, err)
	svc := NewFaviconService(nil, imgProxy)
	svc.httpClient = server.Client()

	result := svc.AnalyzeBrightness(context.Background(), server.URL+"/favicon.png")
	require.NotNil(t, result)
	assert.True(t, *result, "all-black image should be detected as dark")
}

func TestAnalyzeBrightness_LightImage(t *testing.T) {
	whitePNG := createTestPNG(t, color.White)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		_, err := w.Write(whitePNG)
		if err != nil {
			t.Errorf("failed to write test response: %v", err)
		}
	}))
	defer server.Close()

	imgProxy, err := NewImgProxyService("", "", "")
	require.NoError(t, err)
	svc := NewFaviconService(nil, imgProxy)
	svc.httpClient = server.Client()

	result := svc.AnalyzeBrightness(context.Background(), server.URL+"/favicon.png")
	require.NotNil(t, result)
	assert.False(t, *result, "all-white image should not be detected as dark")
}

func TestAnalyzeBrightness_EmptyURL(t *testing.T) {
	imgProxy, err := NewImgProxyService("", "", "")
	require.NoError(t, err)
	svc := NewFaviconService(nil, imgProxy)

	result := svc.AnalyzeBrightness(context.Background(), "")
	assert.Nil(t, result)
}

func TestDiscoverFaviconsFromHTML_PrefersRealIconLinks(t *testing.T) {
	body := `<!doctype html>
<html>
<head>
	<link rel="apple-touch-icon" sizes="180x180" href="/wp-content/themes/antoineguilbert/favicon/apple-touch-icon.png?v=2">
	<link rel="icon" type="image/png" sizes="32x32" href="/wp-content/themes/antoineguilbert/favicon/favicon-32x32.png?v=2">
	<link rel="icon" type="image/png" sizes="16x16" href="/wp-content/themes/antoineguilbert/favicon/favicon-16x16.png?v=2">
	<link rel="manifest" href="/wp-content/themes/antoineguilbert/favicon/site.webmanifest?v=2">
	<link rel="mask-icon" href="/wp-content/themes/antoineguilbert/favicon/safari-pinned-tab.svg?v=2" color="#5bbad5">
	<link rel="shortcut icon" href="/wp-content/themes/antoineguilbert/favicon/favicon.ico?v=2">
</head>
</html>`

	got := discoverFaviconsFromHTML("https://www.antoineguilbert.fr/", body)
	require.NotEmpty(t, got)
	assert.Equal(t, "https://www.antoineguilbert.fr/wp-content/themes/antoineguilbert/favicon/favicon-32x32.png?v=2", got[0])
	assert.Contains(t, got, "https://www.antoineguilbert.fr/wp-content/themes/antoineguilbert/favicon/favicon.ico?v=2")
	assert.Contains(t, got, "https://www.antoineguilbert.fr/wp-content/themes/antoineguilbert/favicon/apple-touch-icon.png?v=2")
	assert.NotContains(t, got, "https://www.antoineguilbert.fr/wp-content/themes/antoineguilbert/favicon/site.webmanifest?v=2")
	assert.NotContains(t, got, "https://www.antoineguilbert.fr/wp-content/themes/antoineguilbert/favicon/safari-pinned-tab.svg?v=2")
}

func TestDiscoverFaviconsFromHTML_ResolvesAndDeduplicatesLinks(t *testing.T) {
	body := `<!doctype html>
<html>
<head>
	<link rel="icon" href="//cdn.example.com/favicon.ico">
	<link rel="icon" href="/favicon.ico">
	<link rel="icon" href="/favicon.ico">
	<link rel="icon" href="javascript:alert(1)">
</head>
</html>`

	got := discoverFaviconsFromHTML("https://example.com/blog/", body)
	assert.Equal(t, []string{
		"https://cdn.example.com/favicon.ico",
		"https://example.com/favicon.ico",
	}, got)
}

func TestProbeFaviconCandidates_SkipsEmptyFavicon(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "image/x-icon")
		w.Header().Set("Content-Length", "0")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	got := probeFaviconCandidates(context.Background(), server.Client(), []string{server.URL + "/favicon.ico"})
	assert.Empty(t, got)
}

func TestProbeFaviconCandidates_FallsBackToGetWhenHeadNotSupported(t *testing.T) {
	blackPNG := createTestPNG(t, color.Black)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/favicon.png" {
			http.NotFound(w, r)
			return
		}
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}

		w.Header().Set("Content-Type", "image/png")
		w.WriteHeader(http.StatusOK)
		_, err := w.Write(blackPNG)
		if err != nil {
			t.Errorf("failed to write test response: %v", err)
		}
	}))
	defer server.Close()

	got := probeFaviconCandidates(context.Background(), server.Client(), []string{server.URL + "/favicon.png"})
	assert.Equal(t, server.URL+"/favicon.png", got)
}

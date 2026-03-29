package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestRateLimiter_Allow(t *testing.T) {
	rl := newRateLimiter(3, 1*time.Minute)

	assert.True(t, rl.allow("a"))
	assert.True(t, rl.allow("a"))
	assert.True(t, rl.allow("a"))
	assert.False(t, rl.allow("a"))

	// Different key is independent
	assert.True(t, rl.allow("b"))
}

func TestRateLimitByIP_StripPort(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := RateLimitByIP(2, 1*time.Minute)(ok)

	// Requests from the same IP but different ports share a bucket.
	for i, port := range []string{"12345", "12346"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "192.168.1.1:" + port
		rec := httptest.NewRecorder()
		mw.ServeHTTP(rec, req)
		assert.Equal(t, http.StatusOK, rec.Code, "request %d should succeed", i)
	}

	// Third request from the same IP (different port) should be rate-limited.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.1:99999"
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
}

func TestRateLimitByIP_IgnoresXForwardedFor(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mw := RateLimitByIP(1, 1*time.Minute)(ok)

	// First request from 10.0.0.1 — allowed.
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:1111"
	rec := httptest.NewRecorder()
	mw.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusOK, rec.Code)

	// Second request from the same IP with a spoofed X-Forwarded-For — still limited.
	req = httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:2222"
	req.Header.Set("X-Forwarded-For", "1.2.3.4")
	rec = httptest.NewRecorder()
	mw.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
}

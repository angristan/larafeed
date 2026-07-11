package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
)

func TestSummaryRateLimiter_IsPerUserAndResets(t *testing.T) {
	now := time.Date(2026, time.July, 11, 12, 0, 0, 0, time.UTC)
	limiter := newSummaryRateLimiter(2, time.Minute)
	limiter.now = func() time.Time { return now }

	allowed, _ := limiter.allow(1)
	assert.True(t, allowed)
	allowed, _ = limiter.allow(1)
	assert.True(t, allowed)
	allowed, retryAfter := limiter.allow(1)
	assert.False(t, allowed)
	assert.Equal(t, time.Minute, retryAfter)

	allowed, _ = limiter.allow(2)
	assert.True(t, allowed, "a different user must have an independent limit")

	now = now.Add(time.Minute)
	allowed, _ = limiter.allow(1)
	assert.True(t, allowed, "the user's window must reset")
}

func TestShouldResolveSummary(t *testing.T) {
	tests := []struct {
		name           string
		summarize      string
		entry          string
		component      string
		requestedProps map[string]struct{}
		want           bool
	}{
		{name: "summary deferred request", summarize: "true", entry: "42", component: readerComponent, requestedProps: map[string]struct{}{"summary": {}}, want: true},
		{name: "all props partial request", summarize: "true", entry: "42", component: readerComponent, want: true},
		{name: "different prop", summarize: "true", entry: "42", component: readerComponent, requestedProps: map[string]struct{}{"entries": {}}, want: false},
		{name: "initial page load", summarize: "true", entry: "42", want: true},
		{name: "different component", summarize: "true", entry: "42", component: "Other/Page", want: false},
		{name: "summary disabled", entry: "42", component: readerComponent, requestedProps: map[string]struct{}{"summary": {}}, want: false},
		{name: "entry missing", summarize: "true", component: readerComponent, requestedProps: map[string]struct{}{"summary": {}}, want: false},
		{name: "entry invalid", summarize: "true", entry: "nope", component: readerComponent, requestedProps: map[string]struct{}{"summary": {}}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/feeds?summarize="+tt.summarize+"&entry="+tt.entry, nil)
			req.Header.Set("X-Inertia-Partial-Component", tt.component)

			assert.Equal(t, tt.want, shouldResolveSummary(req, tt.requestedProps))
		})
	}
}

func TestReaderHandler_SummaryRateLimitReturnsTooManyRequests(t *testing.T) {
	limiter := newSummaryRateLimiter(1, time.Minute)
	allowed, _ := limiter.allow(7)
	assert.True(t, allowed)

	h := &ReaderHandler{summaryLimiter: limiter}
	req := httptest.NewRequest(http.MethodGet, "/feeds?summarize=true&entry=42", nil)
	req = req.WithContext(auth.SetUserInContext(req.Context(), &db.User{ID: 7}))
	recorder := httptest.NewRecorder()

	h.Show(recorder, req)

	assert.Equal(t, http.StatusTooManyRequests, recorder.Code)
	assert.NotEmpty(t, recorder.Header().Get("Retry-After"))
}

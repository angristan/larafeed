package handler

import (
	"net/http"
	"strconv"
	"sync"
	"time"
)

const (
	readerComponent          = "Reader/Reader"
	summaryRequestsPerWindow = 5
	summaryRateLimitWindow   = time.Minute
)

type summaryRateWindow struct {
	count   int
	resetAt time.Time
}

// summaryRateLimiter bounds summary resolutions per user. Summaries are
// deferred props rather than a dedicated route, so the limiter is applied by
// ReaderHandler when the summary prop is actually requested.
type summaryRateLimiter struct {
	mu          sync.Mutex
	limit       int
	window      time.Duration
	now         func() time.Time
	windows     map[int64]summaryRateWindow
	nextCleanup time.Time
}

func newSummaryRateLimiter(limit int, window time.Duration) *summaryRateLimiter {
	return &summaryRateLimiter{
		limit:   limit,
		window:  window,
		now:     time.Now,
		windows: make(map[int64]summaryRateWindow),
	}
}

func (l *summaryRateLimiter) allow(userID int64) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	l.cleanupExpired(now)

	userWindow, ok := l.windows[userID]
	if !ok || !now.Before(userWindow.resetAt) {
		userWindow = summaryRateWindow{resetAt: now.Add(l.window)}
	}

	if userWindow.count >= l.limit {
		return false, userWindow.resetAt.Sub(now)
	}

	userWindow.count++
	l.windows[userID] = userWindow
	return true, 0
}

func (l *summaryRateLimiter) cleanupExpired(now time.Time) {
	if !l.nextCleanup.IsZero() && now.Before(l.nextCleanup) {
		return
	}

	for userID, userWindow := range l.windows {
		if !now.Before(userWindow.resetAt) {
			delete(l.windows, userID)
		}
	}
	l.nextCleanup = now.Add(l.window)
}

func shouldResolveSummary(r *http.Request, requestedProps map[string]struct{}) bool {
	if r.URL.Query().Get("summarize") != "true" {
		return false
	}

	entryID, err := strconv.ParseInt(r.URL.Query().Get("entry"), 10, 64)
	if err != nil || entryID <= 0 {
		return false
	}

	component := r.Header.Get("X-Inertia-Partial-Component")
	if component != "" && component != readerComponent {
		return false
	}

	if len(requestedProps) == 0 {
		return true
	}

	_, ok := requestedProps["summary"]
	return ok
}

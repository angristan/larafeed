package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmcdole/gofeed"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

type FeedService struct {
	q          db.Querier
	pool       *pgxpool.Pool
	filter     *FilterService
	favicon    *FaviconService
	httpClient *http.Client
}

func NewFeedService(q db.Querier, pool *pgxpool.Pool, filter *FilterService, favicon *FaviconService) *FeedService {
	return &FeedService{
		q:          q,
		pool:       pool,
		filter:     filter,
		favicon:    favicon,
		httpClient: safeHTTPClient(),
	}
}

type FetchResult struct {
	Title        string
	FeedURL      string // actual feed URL (may differ from input if discovered)
	SiteURL      string
	Items        []*gofeed.Item
	ETag         string // ETag response header (for conditional GET)
	LastModified string // Last-Modified response header (for conditional GET)
}

// Sentinel errors for HTTP status codes during feed refresh.
var (
	ErrNotModified = errors.New("feed not modified (304)")
	ErrFeedGone    = errors.New("feed permanently removed (410)")
	ErrTooManyReqs = errors.New("rate limited by server (429)")
)

// retryAfterError wraps ErrTooManyReqs and carries the parsed Retry-After time.
type retryAfterError struct {
	retryAt time.Time
}

func (e *retryAfterError) Error() string {
	return fmt.Sprintf("rate limited by server (429), retry after %s", e.retryAt.Format(time.RFC3339))
}

func (e *retryAfterError) Unwrap() error { return ErrTooManyReqs }

// safeHTTPClient returns an HTTP client that prevents SSRF by validating
// resolved IPs at dial time, eliminating the TOCTOU gap between DNS
// resolution and connection (DNS rebinding protection).
func safeHTTPClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("split host port: %w", err)
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, fmt.Errorf("DNS lookup: %w", err)
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("no IPs resolved for %s", host)
			}
			publicIPs := publicIPAddrs(ips)
			if len(publicIPs) == 0 {
				return nil, fmt.Errorf("private IP not allowed: %s", ips[0].IP)
			}
			// Dial the first public resolved IP directly — no second lookup.
			pinnedAddr := net.JoinHostPort(publicIPs[0].IP.String(), port)
			return dialer.DialContext(ctx, network, pinnedAddr)
		},
	}
	return &http.Client{
		Transport: otelhttp.NewTransport(transport),
		Timeout:   30 * time.Second,
	}
}

// FetchFeed fetches and parses a feed URL. If the URL points to an HTML page,
// it attempts to discover feed links via <link rel="alternate"> tags.
// The initial fetch is reused for both parsing and discovery to avoid duplicate requests.
func (s *FeedService) FetchFeed(ctx context.Context, feedURL string) (*FetchResult, error) {
	// Bound the entire operation (initial fetch + discovery probes + parse)
	// which can chain multiple HTTP calls, each with its own 30s client timeout.
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	err := validateScheme(feedURL)
	if err != nil {
		return nil, fmt.Errorf("unsafe URL: %w", err)
	}

	client := s.httpClient

	// Single fetch — reuse the body for both feed parsing and discovery.
	req, err := http.NewRequestWithContext(ctx, "GET", feedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "Larafeed/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch feed: %w", err)
	}
	defer func() {
		closeErr := resp.Body.Close()
		if closeErr != nil {
			slog.WarnContext(ctx, "failed to close response body", "error", closeErr)
		}
	}()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024)) // 2MB limit
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	parser := gofeed.NewParser()
	parser.UserAgent = "Larafeed/1.0"
	parser.Client = s.httpClient
	actualFeedURL := feedURL

	// Try parsing the body as a feed directly.
	feed, err := parser.ParseString(string(body))
	if err != nil {
		// Not a feed — try discovering a feed URL from the HTML body.
		discovered := discoverFeedFromHTML(feedURL, string(body))
		if discovered == "" {
			// Fallback: probe common feed paths.
			discovered = probeFeedPaths(ctx, feedURL)
		}
		if discovered == "" {
			return nil, fmt.Errorf("parse feed: %w", err)
		}
		err = validateScheme(discovered)
		if err != nil {
			return nil, fmt.Errorf("unsafe discovered URL: %w", err)
		}
		feed, err = parser.ParseURLWithContext(discovered, ctx)
		if err != nil {
			return nil, fmt.Errorf("parse discovered feed: %w", err)
		}
		actualFeedURL = discovered
	}

	siteURL := feed.Link
	if siteURL == "" {
		u, err := url.Parse(feedURL)
		if err == nil {
			siteURL = fmt.Sprintf("%s://%s", u.Scheme, u.Host)
		}
	}

	return &FetchResult{
		Title:   feed.Title,
		FeedURL: actualFeedURL,
		SiteURL: siteURL,
		Items:   feed.Items,
	}, nil
}

// discoverFeedFromHTML looks for feed <link> tags in an already-fetched HTML body.
func discoverFeedFromHTML(pageURL, body string) string {
	// Look for <link rel="alternate" type="application/rss+xml" href="...">
	// or type="application/atom+xml" or type="application/feed+json"
	re := regexp.MustCompile(`(?i)<link[^>]+rel=["']?alternate["']?[^>]*>`)
	matches := re.FindAllString(body, -1)

	feedTypes := []string{"application/rss+xml", "application/atom+xml", "application/feed+json"}
	hrefRe := regexp.MustCompile(`(?i)href=["']?([^\s"'>]+)["']?`)
	typeRe := regexp.MustCompile(`(?i)type=["']?([^\s"'>]+)["']?`)

	for _, match := range matches {
		typeMatch := typeRe.FindStringSubmatch(match)
		if typeMatch == nil {
			continue
		}
		isFeed := false
		for _, ft := range feedTypes {
			if typeMatch[1] == ft {
				isFeed = true
				break
			}
		}
		if !isFeed {
			continue
		}
		hrefMatch := hrefRe.FindStringSubmatch(match)
		if hrefMatch == nil {
			continue
		}

		href := hrefMatch[1]
		base, err := url.Parse(pageURL)
		if err != nil {
			return ""
		}
		ref, err := url.Parse(href)
		if err != nil {
			continue
		}
		return base.ResolveReference(ref).String()
	}

	return ""
}

// probeFeedPaths tries common feed paths as a last resort.
func probeFeedPaths(ctx context.Context, pageURL string) string {
	commonPaths := []string{"/feed", "/rss", "/atom.xml", "/feed.xml", "/rss.xml", "/index.xml"}
	base, err := url.Parse(pageURL)
	if err != nil {
		return ""
	}
	client := safeHTTPClient()
	for _, path := range commonPaths {
		candidate := base.ResolveReference(&url.URL{Path: path}).String()
		parser := gofeed.NewParser()
		parser.UserAgent = "Larafeed/1.0"
		parser.Client = client
		_, parseErr := parser.ParseURLWithContext(candidate, ctx)
		if parseErr == nil {
			return candidate
		}
	}
	return ""
}

// fetchForRefresh fetches a known feed URL with conditional GET support.
// It sends If-None-Match / If-Modified-Since headers when the feed has
// cached ETag / Last-Modified values, and handles 304, 410, and 429 responses.
func (s *FeedService) fetchForRefresh(ctx context.Context, feed *db.Feed) (*FetchResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	client := s.httpClient

	req, err := http.NewRequestWithContext(ctx, "GET", feed.FeedURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "Larafeed/1.0")

	if feed.ETag != nil && *feed.ETag != "" {
		req.Header.Set("If-None-Match", *feed.ETag)
	}
	if feed.LastModified != nil && *feed.LastModified != "" {
		req.Header.Set("If-Modified-Since", *feed.LastModified)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch feed: %w", err)
	}
	defer func() {
		closeErr := resp.Body.Close()
		if closeErr != nil {
			slog.WarnContext(ctx, "failed to close response body", "error", closeErr)
		}
	}()

	switch resp.StatusCode {
	case http.StatusNotModified:
		return nil, ErrNotModified
	case http.StatusGone:
		return nil, ErrFeedGone
	case http.StatusTooManyRequests:
		retryAt := parseRetryAfter(resp.Header.Get("Retry-After"))
		return nil, &retryAfterError{retryAt: retryAt}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	parser := gofeed.NewParser()
	parser.UserAgent = "Larafeed/1.0"
	parsedFeed, err := parser.ParseString(string(body))
	if err != nil {
		return nil, fmt.Errorf("parse feed: %w", err)
	}

	siteURL := parsedFeed.Link
	if siteURL == "" {
		u, parseErr := url.Parse(feed.FeedURL)
		if parseErr == nil {
			siteURL = fmt.Sprintf("%s://%s", u.Scheme, u.Host)
		}
	}

	return &FetchResult{
		Title:        parsedFeed.Title,
		FeedURL:      feed.FeedURL,
		SiteURL:      siteURL,
		Items:        parsedFeed.Items,
		ETag:         resp.Header.Get("ETag"),
		LastModified: resp.Header.Get("Last-Modified"),
	}, nil
}

// parseRetryAfter parses a Retry-After header value, which can be either
// a number of seconds or an HTTP-date (RFC 7231 §7.1.3).
func parseRetryAfter(value string) time.Time {
	if value == "" {
		return time.Now().Add(1 * time.Hour) // default: 1 hour
	}

	// Try as seconds first.
	var n int
	_, scanErr := fmt.Sscan(value, &n)
	if scanErr == nil && n > 0 {
		if n > 86400 { // cap at 24h
			n = 86400
		}
		return time.Now().Add(time.Duration(n) * time.Second)
	}

	// Try as HTTP-date.
	t, parseErr := http.ParseTime(value)
	if parseErr == nil {
		return t
	}

	return time.Now().Add(1 * time.Hour) // fallback
}

// IngestEntries converts feed items to entries and bulk-inserts them.
// The dbtx parameter allows callers to pass either the pool (for standalone use)
// or a transaction (for use within RefreshFeed).
func (s *FeedService) IngestEntries(ctx context.Context, dbtx db.DBTX, feedID int64, items []*gofeed.Item, limit int) ([]db.Entry, error) {
	return s.ingestEntries(ctx, db.New(dbtx), dbtx, feedID, items, limit)
}

func (s *FeedService) ingestEntries(ctx context.Context, q db.Querier, dbtx db.DBTX, feedID int64, items []*gofeed.Item, limit int) ([]db.Entry, error) {
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	// Collect candidate URLs from the batch, then check which already exist.
	// Only sends the batch's URLs to PG instead of fetching all URLs for the feed.
	candidateURLs := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		link := itemLink(item)
		if link == "" {
			continue
		}
		if _, ok := seen[link]; !ok {
			seen[link] = struct{}{}
			candidateURLs = append(candidateURLs, link)
		}
	}

	existingURLs := make(map[string]struct{})
	if len(candidateURLs) > 0 {
		existing, err := q.EntryURLsForFeedIn(ctx, db.EntryURLsForFeedInParams{
			FeedID: feedID,
			Urls:   candidateURLs,
		})
		if err != nil {
			return nil, fmt.Errorf("check existing URLs: %w", err)
		}
		for _, u := range existing {
			existingURLs[u] = struct{}{}
		}
	}

	now := time.Now()
	seenInBatch := make(map[string]struct{}, len(items))
	var toInsert []db.Entry
	for _, item := range items {
		link := itemLink(item)
		if link == "" || item.Title == "" {
			continue
		}

		if _, exists := existingURLs[link]; exists {
			continue
		}
		if _, exists := seenInBatch[link]; exists {
			continue
		}
		seenInBatch[link] = struct{}{}

		publishedAt := now
		if item.PublishedParsed != nil {
			publishedAt = *item.PublishedParsed
		} else if item.UpdatedParsed != nil {
			publishedAt = *item.UpdatedParsed
		}

		if publishedAt.After(now) {
			continue
		}

		var author *string
		if item.Author != nil && item.Author.Name != "" {
			author = &item.Author.Name
		}

		content := item.Content
		if content == "" {
			content = item.Description
		}
		var contentPtr *string
		if content != "" {
			contentPtr = &content
		}

		toInsert = append(toInsert, db.Entry{
			FeedID:      feedID,
			Title:       item.Title,
			URL:         link,
			Author:      author,
			Content:     contentPtr,
			PublishedAt: publishedAt,
		})
	}

	return db.BulkCreate(ctx, dbtx, toInsert)
}

// itemLink returns the effective URL for a feed item, falling back to the
// GUID when no explicit link is present (some feeds use <guid isPermaLink="true">
// as the only URL).
func itemLink(item *gofeed.Item) string {
	if item.Link != "" {
		return item.Link
	}
	if item.GUID != "" && strings.HasPrefix(item.GUID, "http") {
		return item.GUID
	}
	return ""
}

// RefreshFeed fetches a feed and ingests new entries inside a transaction.
// Handles conditional GET (304), gone feeds (410), rate limiting (429),
// and exponential backoff on consecutive failures.
func (s *FeedService) RefreshFeed(ctx context.Context, feed *db.Feed) (int, error) {
	result, err := s.fetchForRefresh(ctx, feed)
	if err != nil {
		return s.handleRefreshError(ctx, feed, err)
	}

	var newEntries []db.Entry
	err = db.WithTx(ctx, s.pool, func(ctx context.Context, tx pgx.Tx) error {
		var ingestErr error
		newEntries, ingestErr = s.IngestEntries(ctx, tx, feed.ID, result.Items, 0)
		if ingestErr != nil {
			return fmt.Errorf("ingest entries: %w", ingestErr)
		}

		qtx := db.New(tx)
		refreshErr := qtx.UpdateFeedRefreshSuccess(ctx, db.UpdateFeedRefreshSuccessParams{
			ID:           feed.ID,
			ETag:         strPtr(result.ETag),
			LastModified: strPtr(result.LastModified),
		})
		if refreshErr != nil {
			return refreshErr
		}
		count := len(newEntries)
		return qtx.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &count})
	})
	if err != nil {
		return 0, err
	}

	// Apply subscription filters outside the transaction (best-effort)
	if len(newEntries) > 0 {
		subs, err := s.q.SubscriptionsWithFilters(ctx, feed.ID)
		if err != nil {
			slog.WarnContext(ctx, "failed to get subscriptions for filtering", "error", err, "feed_id", feed.ID)
		}
		for _, sub := range subs {
			s.filter.ApplyFilters(ctx, sub, newEntries)
		}
	}

	return len(newEntries), nil
}

// handleRefreshError processes errors from fetchForRefresh, recording the
// appropriate state in the database depending on the error type.
func (s *FeedService) handleRefreshError(ctx context.Context, feed *db.Feed, err error) (int, error) {
	switch {
	case errors.Is(err, ErrNotModified):
		// 304: Feed unchanged — treat as success (reset failures, update timestamp).
		dbErr := s.q.UpdateFeedRefreshSuccess(ctx, db.UpdateFeedRefreshSuccessParams{
			ID:           feed.ID,
			ETag:         feed.ETag,
			LastModified: feed.LastModified,
		})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record 304 success", "error", dbErr, "feed_id", feed.ID)
		}
		zero := 0
		dbErr = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &zero})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record refresh", "error", dbErr, "feed_id", feed.ID)
		}
		return 0, nil // not an error from caller's perspective

	case errors.Is(err, ErrFeedGone):
		// 410: Feed permanently removed — mark as gone, stop refreshing.
		dbErr := s.q.UpdateFeedGone(ctx, feed.ID)
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to mark feed as gone", "error", dbErr, "feed_id", feed.ID)
		}
		errMsg := err.Error()
		dbErr = s.q.UpdateFeedRefreshFailure(ctx, db.UpdateFeedRefreshFailureParams{ID: feed.ID, LastErrorMessage: &errMsg})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record refresh failure", "error", dbErr, "feed_id", feed.ID)
		}
		zero := 0
		dbErr = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: false, EntriesCreated: &zero, ErrorMessage: &errMsg})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record refresh", "error", dbErr, "feed_id", feed.ID)
		}
		return 0, err

	case errors.Is(err, ErrTooManyReqs):
		// 429: Rate limited — set retry_after from server's Retry-After header.
		var raErr *retryAfterError
		if errors.As(err, &raErr) {
			retryAt := raErr.retryAt
			dbErr := s.q.UpdateFeedRetryAfter(ctx, db.UpdateFeedRetryAfterParams{ID: feed.ID, RetryAfter: &retryAt})
			if dbErr != nil {
				slog.WarnContext(ctx, "failed to set retry_after", "error", dbErr, "feed_id", feed.ID)
			}
		}
		errMsg := err.Error()
		zero := 0
		dbErr := s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: false, EntriesCreated: &zero, ErrorMessage: &errMsg})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record refresh", "error", dbErr, "feed_id", feed.ID)
		}
		return 0, err

	default:
		// Generic error — record failure with exponential backoff
		// (backoff is computed in SQL via consecutive_failures).
		errMsg := err.Error()
		dbErr := s.q.UpdateFeedRefreshFailure(ctx, db.UpdateFeedRefreshFailureParams{ID: feed.ID, LastErrorMessage: &errMsg})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record refresh failure", "error", dbErr, "feed_id", feed.ID)
		}
		zero := 0
		dbErr = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: false, EntriesCreated: &zero, ErrorMessage: &errMsg})
		if dbErr != nil {
			slog.WarnContext(ctx, "failed to record refresh", "error", dbErr, "feed_id", feed.ID)
		}
		return 0, err
	}
}

// strPtr returns a pointer to the string, or nil if empty.
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// CreateFeed creates a new feed or returns existing, subscribes the user.
func (s *FeedService) CreateFeed(ctx context.Context, userID int64, feedURL string, categoryID int64, fallbackName string) (*db.Feed, error) {
	if strings.TrimSpace(feedURL) == "" {
		return nil, apperr.NewValidation("feed_url", "A feed URL is required.")
	}
	err := validateScheme(feedURL)
	if err != nil {
		return nil, apperr.NewValidation("feed_url", "The feed URL must use http or https.")
	}

	// Check if feed exists
	existing, err := s.q.FindFeedByURL(ctx, feedURL)
	if err == nil {
		// Subscribe user to existing feed
		subErr := s.q.Subscribe(ctx, db.SubscribeParams{UserID: userID, FeedID: existing.ID, CategoryID: categoryID})
		if subErr != nil {
			return nil, fmt.Errorf("subscribe to existing feed: %w", subErr)
		}
		return &existing, nil
	}

	// Fetch feed (may discover actual feed URL from HTML page)
	result, err := s.FetchFeed(ctx, feedURL)
	if err != nil {
		return nil, err
	}

	// Use the actual feed URL (may differ if auto-discovered from HTML)
	actualURL := result.FeedURL

	// Check again with discovered URL in case it already exists
	if actualURL != feedURL {
		existing, findErr := s.q.FindFeedByURL(ctx, actualURL)
		if findErr == nil {
			subErr := s.q.Subscribe(ctx, db.SubscribeParams{UserID: userID, FeedID: existing.ID, CategoryID: categoryID})
			if subErr != nil {
				return nil, fmt.Errorf("subscribe to discovered feed: %w", subErr)
			}
			return &existing, nil
		}
	}

	name := result.Title
	if name == "" {
		name = fallbackName
	}
	if name == "" {
		name = actualURL
	}

	now := time.Now()
	feed, err := s.q.CreateFeed(ctx, db.CreateFeedParams{Name: name, FeedURL: actualURL, SiteURL: result.SiteURL, CreatedAt: &now})
	if err != nil {
		return nil, fmt.Errorf("create feed: %w", err)
	}

	err = s.q.Subscribe(ctx, db.SubscribeParams{UserID: userID, FeedID: feed.ID, CategoryID: categoryID})
	if err != nil {
		return nil, fmt.Errorf("subscribe to new feed: %w", err)
	}

	// Ingest initial entries (limit 20)
	newEntries, err := s.IngestEntries(ctx, s.pool, feed.ID, result.Items, 20)
	if err != nil {
		return nil, fmt.Errorf("ingest initial entries: %w", err)
	}
	count := len(newEntries)
	err = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &count})
	if err != nil {
		slog.WarnContext(ctx, "failed to record refresh", "error", err, "feed_id", feed.ID)
	}
	err = s.q.UpdateFeedRefreshSuccess(ctx, db.UpdateFeedRefreshSuccessParams{ID: feed.ID})
	if err != nil {
		slog.WarnContext(ctx, "failed to update refresh success", "error", err, "feed_id", feed.ID)
	}

	// Fetch favicon synchronously so it's available before the UI renders.
	if s.favicon != nil {
		faviconCtx, faviconCancel := context.WithTimeout(ctx, 5*time.Second)
		defer faviconCancel()
		err = s.favicon.RefreshFavicon(faviconCtx, &feed)
		if err != nil {
			slog.WarnContext(ctx, "failed to fetch favicon during feed creation", "error", err, "feed_id", feed.ID)
		}
	}

	return &feed, nil
}

// validateScheme checks that a URL uses http or https.
// Full SSRF protection (private IP, DNS rebinding) is handled by safeHTTPClient.
func validateScheme(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("invalid scheme: %s", u.Scheme)
	}

	return nil
}

// ValidateURL checks if a URL has an allowed scheme and at least one public DNS answer.
// Callers that fetch URLs must still use safeHTTPClient to pin the safe address at dial time.
func ValidateURL(rawURL string) error {
	err := validateScheme(rawURL)
	if err != nil {
		return err
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	host := u.Hostname()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("DNS lookup failed: %w", err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("no IPs resolved for %s", host)
	}
	if len(publicIPAddrs(ips)) == 0 {
		return fmt.Errorf("private IP not allowed: %s", ips[0].IP)
	}

	return nil
}

var privateNetworks []*net.IPNet

func init() {
	for _, cidr := range []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7",
	} {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(fmt.Sprintf("invalid private CIDR %q: %v", cidr, err))
		}
		privateNetworks = append(privateNetworks, network)
	}
}

func isPrivateIP(ip net.IP) bool {
	for _, network := range privateNetworks {
		if network.Contains(ip) {
			return true
		}
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
}

func publicIPAddrs(ips []net.IPAddr) []net.IPAddr {
	public := make([]net.IPAddr, 0, len(ips))
	for _, ipAddr := range ips {
		if !isPrivateIP(ipAddr.IP) {
			public = append(public, ipAddr)
		}
	}
	return public
}

// Pagination helpers
type PaginatedResult struct {
	Data        any `json:"data"`
	CurrentPage int `json:"current_page"`
	LastPage    int `json:"last_page"`
	PerPage     int `json:"per_page"`
	Total       int `json:"total"`
}

func Paginate(data any, total, page, perPage int) PaginatedResult {
	lastPage := (total + perPage - 1) / perPage
	if lastPage < 1 {
		lastPage = 1
	}
	return PaginatedResult{
		Data:        data,
		CurrentPage: page,
		LastPage:    lastPage,
		PerPage:     perPage,
		Total:       total,
	}
}

// FindFeedByID returns a feed by its ID.
func (s *FeedService) FindFeedByID(ctx context.Context, feedID int64) (*db.Feed, error) {
	feed, err := s.q.FindFeedByID(ctx, feedID)
	if err != nil {
		return nil, apperr.NewNotFound("feed")
	}
	return &feed, nil
}

// MarkAllAsRead marks all unread entries for a feed as read.
func (s *FeedService) MarkAllAsRead(ctx context.Context, userID, feedID int64) error {
	return db.MarkAllAsRead(ctx, s.q, userID, feedID)
}

// ResolveCategory resolves a category by ID or creates one by name.
func (s *FeedService) ResolveCategory(ctx context.Context, userID int64, categoryID *int64, categoryName string) (int64, error) {
	if categoryID != nil {
		return *categoryID, nil
	}
	if categoryName != "" {
		cat, err := s.q.FindOrCreateCategory(ctx, db.FindOrCreateCategoryParams{UserID: userID, Name: categoryName})
		if err != nil {
			return 0, fmt.Errorf("create category: %w", err)
		}
		return cat.ID, nil
	}
	return 0, apperr.NewValidation("category_id", "A category is required.")
}

// Unsubscribe removes a user's subscription and cleans up the feed if no subscribers remain.
func (s *FeedService) Unsubscribe(ctx context.Context, userID int64, feedID int64) error {
	return db.WithTx(ctx, s.pool, func(ctx context.Context, tx pgx.Tx) error {
		qtx := db.New(tx)
		err := qtx.DeleteInteractionsForFeed(ctx, db.DeleteInteractionsForFeedParams{UserID: userID, FeedID: feedID})
		if err != nil {
			return err
		}
		err = qtx.Unsubscribe(ctx, db.UnsubscribeParams{UserID: userID, FeedID: feedID})
		if err != nil {
			return err
		}
		count, err := qtx.CountFeedSubscribers(ctx, feedID)
		if err != nil {
			return err
		}
		if count == 0 {
			err = qtx.DeleteFeed(ctx, feedID)
			if err != nil {
				return err
			}
		}
		return nil
	})
}

// UpdateSubscription updates a subscription's category, name, and filter rules.
// If filterRulesJSON is non-nil, filters are re-applied to all existing entries.
func (s *FeedService) UpdateSubscription(ctx context.Context, userID, feedID, categoryID int64, customName *string, filterRulesJSON json.RawMessage) error {
	if filterRulesJSON != nil {
		var rules FilterRules
		unmarshalErr := json.Unmarshal(filterRulesJSON, &rules)
		if unmarshalErr != nil {
			return apperr.NewValidation("filter_rules", "Invalid filter rules format.")
		}
		allPatterns := append(append(rules.ExcludeTitle, rules.ExcludeContent...), rules.ExcludeAuthor...)
		for _, pattern := range allPatterns {
			if pattern != "" && !ValidateFilterPattern(pattern) {
				return apperr.NewValidation("filter_rules", "Invalid or unsafe filter pattern.")
			}
		}
	}

	err := s.q.UpdateSubscription(ctx, db.UpdateSubscriptionParams{
		UserID: userID, FeedID: feedID, CategoryID: categoryID,
		CustomFeedName: customName, FilterRules: filterRulesJSON,
	})
	if err != nil {
		return err
	}

	// Re-apply filters if rules were provided
	if filterRulesJSON != nil {
		sub, err := s.q.GetSubscription(ctx, db.GetSubscriptionParams{UserID: userID, FeedID: feedID})
		if err == nil {
			allEntries, err := s.q.EntriesForFeed(ctx, feedID)
			if err != nil {
				slog.WarnContext(ctx, "failed to get entries for filtering", "error", err, "feed_id", feedID)
			}
			s.filter.ApplyFilters(ctx, sub, allEntries)
		}
	}

	return nil
}

func (s *FeedService) IsUserSubscribed(ctx context.Context, userID, feedID int64) (bool, error) {
	_, err := s.q.GetSubscription(ctx, db.GetSubscriptionParams{UserID: userID, FeedID: feedID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Helpers
func StringContainsAny(s string, substrs []string) bool {
	lower := strings.ToLower(s)
	for _, sub := range substrs {
		if strings.Contains(lower, strings.ToLower(sub)) {
			return true
		}
	}
	return false
}

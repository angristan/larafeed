package service

import (
	"context"
	"encoding/json"
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
	q      db.Querier
	pool   *pgxpool.Pool
	filter *FilterService
}

func NewFeedService(q db.Querier, pool *pgxpool.Pool, filter *FilterService) *FeedService {
	return &FeedService{
		q:      q,
		pool:   pool,
		filter: filter,
	}
}

type FetchResult struct {
	Title   string
	FeedURL string // actual feed URL (may differ from input if discovered)
	SiteURL string
	Items   []*gofeed.Item
}

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
			for _, ipAddr := range ips {
				if isPrivateIP(ipAddr.IP) {
					return nil, fmt.Errorf("private IP not allowed: %s", ipAddr.IP)
				}
			}
			// Dial the first resolved IP directly — no second lookup.
			pinnedAddr := net.JoinHostPort(ips[0].IP.String(), port)
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
	if err := validateScheme(feedURL); err != nil {
		return nil, fmt.Errorf("unsafe URL: %w", err)
	}

	client := safeHTTPClient()

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
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2*1024*1024)) // 2MB limit
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	parser := gofeed.NewParser()
	parser.UserAgent = "Larafeed/1.0"
	parser.Client = safeHTTPClient()
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
		if err := validateScheme(discovered); err != nil {
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
		u, _ := url.Parse(feedURL)
		if u != nil {
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
		base, _ := url.Parse(pageURL)
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
	base, _ := url.Parse(pageURL)
	for _, path := range commonPaths {
		candidate := base.ResolveReference(&url.URL{Path: path}).String()
		parser := gofeed.NewParser()
		parser.UserAgent = "Larafeed/1.0"
		parser.Client = safeHTTPClient()
		if _, err := parser.ParseURLWithContext(candidate, ctx); err == nil {
			return candidate
		}
	}
	return ""
}

// IngestEntries converts feed items to entries and bulk-inserts them.
// The dbtx parameter allows callers to pass either the pool (for standalone use)
// or a transaction (for use within RefreshFeed).
func (s *FeedService) IngestEntries(ctx context.Context, dbtx db.DBTX, feedID int64, items []*gofeed.Item, limit int) ([]db.Entry, error) {
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}

	var toInsert []db.Entry
	for _, item := range items {
		if item.Link == "" || item.Title == "" {
			continue
		}

		publishedAt := time.Now()
		if item.PublishedParsed != nil {
			publishedAt = *item.PublishedParsed
		} else if item.UpdatedParsed != nil {
			publishedAt = *item.UpdatedParsed
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
			URL:         item.Link,
			Author:      author,
			Content:     contentPtr,
			PublishedAt: publishedAt,
		})
	}

	return db.BulkCreate(ctx, dbtx, toInsert)
}

// RefreshFeed fetches a feed and ingests new entries inside a transaction.
func (s *FeedService) RefreshFeed(ctx context.Context, feed *db.Feed) (int, error) {
	result, err := s.FetchFeed(ctx, feed.FeedURL)
	if err != nil {
		errMsg := err.Error()
		_ = s.q.UpdateFeedRefreshFailure(ctx, db.UpdateFeedRefreshFailureParams{ID: feed.ID, LastErrorMessage: &errMsg})
		zero := 0
		_ = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: false, EntriesCreated: &zero, ErrorMessage: &errMsg})
		return 0, err
	}

	var newEntries []db.Entry
	err = db.WithTx(ctx, s.pool, func(ctx context.Context, tx pgx.Tx) error {
		var ingestErr error
		newEntries, ingestErr = s.IngestEntries(ctx, tx, feed.ID, result.Items, 0)
		if ingestErr != nil {
			return fmt.Errorf("ingest entries: %w", ingestErr)
		}

		qtx := db.New(tx)
		if err := qtx.UpdateFeedRefreshSuccess(ctx, feed.ID); err != nil {
			return err
		}
		count := len(newEntries)
		return qtx.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &count})
	})
	if err != nil {
		return 0, err
	}

	// Apply subscription filters outside the transaction (best-effort)
	if len(newEntries) > 0 {
		subs, _ := s.q.SubscriptionsWithFilters(ctx, feed.ID)
		for _, sub := range subs {
			s.filter.ApplyFilters(ctx, sub, newEntries)
		}
	}

	return len(newEntries), nil
}

// CreateFeed creates a new feed or returns existing, subscribes the user.
func (s *FeedService) CreateFeed(ctx context.Context, userID int64, feedURL string, categoryID int64, fallbackName string) (*db.Feed, error) {
	// Check if feed exists
	existing, err := s.q.FindFeedByURL(ctx, feedURL)
	if err == nil {
		// Subscribe user to existing feed
		_ = s.q.Subscribe(ctx, db.SubscribeParams{UserID: userID, FeedID: existing.ID, CategoryID: categoryID})
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
		existing, err := s.q.FindFeedByURL(ctx, actualURL)
		if err == nil {
			_ = s.q.Subscribe(ctx, db.SubscribeParams{UserID: userID, FeedID: existing.ID, CategoryID: categoryID})
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

	_ = s.q.Subscribe(ctx, db.SubscribeParams{UserID: userID, FeedID: feed.ID, CategoryID: categoryID})

	// Ingest initial entries (limit 20)
	newEntries, _ := s.IngestEntries(ctx, s.pool, feed.ID, result.Items, 20)
	count := len(newEntries)
	_ = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &count})
	_ = s.q.UpdateFeedRefreshSuccess(ctx, feed.ID)

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

// ValidateURL checks if a URL is safe (scheme + DNS resolution + private IP check).
// Used by favicon service and other callers that don't go through safeHTTPClient.
func ValidateURL(rawURL string) error {
	if err := validateScheme(rawURL); err != nil {
		return err
	}

	u, _ := url.Parse(rawURL)
	host := u.Hostname()
	ips, err := net.LookupIP(host)
	if err != nil {
		return fmt.Errorf("DNS lookup failed: %w", err)
	}

	for _, ip := range ips {
		if isPrivateIP(ip) {
			return fmt.Errorf("private IP not allowed: %s", ip)
		}
	}

	return nil
}

func isPrivateIP(ip net.IP) bool {
	privateRanges := []string{
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"127.0.0.0/8", "169.254.0.0/16", "::1/128", "fc00::/7",
	}
	for _, cidr := range privateRanges {
		_, network, _ := net.ParseCIDR(cidr)
		if network.Contains(ip) {
			return true
		}
	}
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			if rbErr := tx.Rollback(ctx); rbErr != nil {
				slog.ErrorContext(ctx, "failed to rollback transaction", "error", rbErr)
			}
		}
	}()

	qtx := db.New(tx)
	if err := qtx.DeleteInteractionsForFeed(ctx, db.DeleteInteractionsForFeedParams{UserID: userID, FeedID: feedID}); err != nil {
		return err
	}
	if err := qtx.Unsubscribe(ctx, db.UnsubscribeParams{UserID: userID, FeedID: feedID}); err != nil {
		return err
	}
	count, err := qtx.CountFeedSubscribers(ctx, feedID)
	if err != nil {
		return err
	}
	if count == 0 {
		if err := qtx.DeleteFeed(ctx, feedID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	committed = true
	return nil
}

// UpdateSubscription updates a subscription's category, name, and filter rules.
// If filterRulesJSON is non-nil, filters are re-applied to all existing entries.
func (s *FeedService) UpdateSubscription(ctx context.Context, userID, feedID, categoryID int64, customName *string, filterRulesJSON json.RawMessage) error {
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
			allEntries, _ := s.q.EntriesForFeed(ctx, feedID)
			s.filter.ApplyFilters(ctx, sub, allEntries)
		}
	}

	return nil
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

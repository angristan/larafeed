package service

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/mmcdole/gofeed"
)

type FeedService struct {
	q      *db.Queries
	pool   *pgxpool.Pool
	filter *FilterService
}

func NewFeedService(q *db.Queries, pool *pgxpool.Pool, filter *FilterService) *FeedService {
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

// FetchFeed fetches and parses a feed URL. If the URL points to an HTML page,
// it attempts to discover feed links via <link rel="alternate"> tags.
func (s *FeedService) FetchFeed(ctx context.Context, feedURL string) (*FetchResult, error) {
	if err := ValidateURL(feedURL); err != nil {
		return nil, fmt.Errorf("unsafe URL: %w", err)
	}

	parser := gofeed.NewParser()
	parser.UserAgent = "Larafeed/1.0"
	actualFeedURL := feedURL
	feed, err := parser.ParseURLWithContext(feedURL, ctx)
	if err != nil {
		// Direct parsing failed — try feed discovery from HTML
		discovered, discoverErr := discoverFeedURL(ctx, feedURL)
		if discoverErr != nil || discovered == "" {
			return nil, fmt.Errorf("parse feed: %w", err)
		}
		if err := ValidateURL(discovered); err != nil {
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

// discoverFeedURL fetches an HTML page and looks for feed <link> tags.
func discoverFeedURL(ctx context.Context, pageURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Larafeed/1.0")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	// Only process HTML responses
	ct := resp.Header.Get("Content-Type")
	if !strings.Contains(ct, "text/html") {
		return "", fmt.Errorf("not HTML: %s", ct)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 512*1024)) // 512KB limit
	if err != nil {
		return "", err
	}

	// Look for <link rel="alternate" type="application/rss+xml" href="...">
	// or type="application/atom+xml" or type="application/feed+json"
	// Handles both quoted and unquoted attribute values
	re := regexp.MustCompile(`(?i)<link[^>]+rel=["']?alternate["']?[^>]*>`)
	matches := re.FindAllString(string(body), -1)

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
		// Resolve relative URLs
		base, _ := url.Parse(pageURL)
		ref, err := url.Parse(href)
		if err != nil {
			continue
		}
		return base.ResolveReference(ref).String(), nil
	}

	// Also try common feed paths as fallback
	commonPaths := []string{"/feed", "/rss", "/atom.xml", "/feed.xml", "/rss.xml", "/index.xml"}
	base, _ := url.Parse(pageURL)
	for _, path := range commonPaths {
		candidate := base.ResolveReference(&url.URL{Path: path}).String()
		parser := gofeed.NewParser()
		parser.UserAgent = "Larafeed/1.0"
		if _, err := parser.ParseURLWithContext(candidate, ctx); err == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("no feed found")
}

// IngestEntries converts feed items to entries and bulk-inserts them.
func (s *FeedService) IngestEntries(ctx context.Context, feedID int64, items []*gofeed.Item, limit int) ([]db.Entry, error) {
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

	return db.BulkCreate(ctx, s.pool, toInsert)
}

// RefreshFeed fetches a feed and ingests new entries.
func (s *FeedService) RefreshFeed(ctx context.Context, feed *db.Feed) (int, error) {
	result, err := s.FetchFeed(ctx, feed.FeedURL)
	if err != nil {
		errMsg := err.Error()
		_ = s.q.UpdateFeedRefreshFailure(ctx, db.UpdateFeedRefreshFailureParams{ID: feed.ID, LastErrorMessage: &errMsg})
		zero := 0
		_ = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: false, EntriesCreated: &zero, ErrorMessage: &errMsg})
		return 0, err
	}

	newEntries, err := s.IngestEntries(ctx, feed.ID, result.Items, 0)
	if err != nil {
		return 0, fmt.Errorf("ingest entries: %w", err)
	}

	_ = s.q.UpdateFeedRefreshSuccess(ctx, feed.ID)
	count := len(newEntries)
	_ = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &count})

	// Apply subscription filters to new entries
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
	newEntries, _ := s.IngestEntries(ctx, feed.ID, result.Items, 20)
	count := len(newEntries)
	_ = s.q.RecordRefresh(ctx, db.RecordRefreshParams{FeedID: feed.ID, WasSuccessful: true, EntriesCreated: &count})
	_ = s.q.UpdateFeedRefreshSuccess(ctx, feed.ID)

	return &feed, nil
}

// ValidateURL checks if a URL is safe (no SSRF).
func ValidateURL(rawURL string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("invalid scheme: %s", u.Scheme)
	}

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

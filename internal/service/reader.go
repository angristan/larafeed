package service

import (
	"context"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
)

type ReaderService struct {
	q          db.Querier
	faviconSvc *FaviconService
	imgProxy   *ImgProxyService
	llm        *LLMService
}

func NewReaderService(q db.Querier, faviconSvc *FaviconService, imgProxy *ImgProxyService, llm *LLMService) *ReaderService {
	return &ReaderService{q: q, faviconSvc: faviconSvc, imgProxy: imgProxy, llm: llm}
}

// ReaderFeed is the feed DTO for the reader sidebar.
type ReaderFeed struct {
	ID                      int64   `json:"id"`
	Name                    string  `json:"name"`
	OriginalName            string  `json:"original_name"`
	FaviconURL              string  `json:"favicon_url"`
	FaviconIsDark           *bool   `json:"favicon_is_dark"`
	SiteURL                 string  `json:"site_url"`
	FeedURL                 string  `json:"feed_url"`
	EntriesCount            int64   `json:"entries_count"`
	LastSuccessfulRefreshAt *string `json:"last_successful_refresh_at"`
	LastFailedRefreshAt     *string `json:"last_failed_refresh_at"`
	CategoryID              int64   `json:"category_id"`
	FilterRules             any     `json:"filter_rules"`
}

// ReaderQuery holds the parsed parameters for the reader entries query.
type ReaderQuery struct {
	FeedID     *int64
	CategoryID *int64
	Filter     string
	OrderBy    string
	Page       int
}

const readerPageSize = 30

// ListFeeds returns the user's subscribed feeds formatted for the reader sidebar.
func (s *ReaderService) ListFeeds(ctx context.Context, userID int64) []ReaderFeed {
	feedRows, _ := s.q.ListSubscriptionsForUser(ctx, userID)
	if feedRows == nil {
		return nil
	}

	feeds := make([]ReaderFeed, len(feedRows))
	for i, f := range feedRows {
		displayName := f.Name
		if f.CustomFeedName != nil && *f.CustomFeedName != "" {
			displayName = *f.CustomFeedName
		}

		var lastSuccess, lastFail *string
		if f.LastSuccessfulRefreshAt != nil {
			s := f.LastSuccessfulRefreshAt.Format(time.RFC3339)
			lastSuccess = &s
		}
		if f.LastFailedRefreshAt != nil {
			s := f.LastFailedRefreshAt.Format(time.RFC3339)
			lastFail = &s
		}

		proxifiedFavicon := s.faviconSvc.BuildProxifiedFaviconURL(f.FaviconURL)
		feeds[i] = ReaderFeed{
			ID:                      f.ID,
			Name:                    displayName,
			OriginalName:            f.Name,
			FaviconURL:              proxifiedFavicon,
			FaviconIsDark:           f.FaviconIsDark,
			SiteURL:                 f.SiteURL,
			FeedURL:                 f.FeedURL,
			EntriesCount:            f.EntryCount,
			LastSuccessfulRefreshAt: lastSuccess,
			LastFailedRefreshAt:     lastFail,
			CategoryID:              f.CategoryID,
			FilterRules:             f.FilterRules,
		}
	}
	return feeds
}

// FetchEntriesPage returns paginated entries for the reader view.
func (s *ReaderService) FetchEntriesPage(ctx context.Context, userID int64, params ReaderQuery) PaginatedResult {
	var feedIDPg, categoryIDPg pgtype.Int8
	if params.FeedID != nil {
		feedIDPg = pgtype.Int8{Int64: *params.FeedID, Valid: true}
	}
	if params.CategoryID != nil {
		categoryIDPg = pgtype.Int8{Int64: *params.CategoryID, Valid: true}
	}

	total, _ := s.q.CountForReader(ctx, db.CountForReaderParams{
		UserID: userID, FeedID: feedIDPg, CategoryID: categoryIDPg, Filter: params.Filter,
	})

	pageOffset := int32((params.Page - 1) * readerPageSize)
	var entries []db.ReaderEntry
	if params.OrderBy == "created_at" {
		rows, _ := s.q.ListForReaderByCreated(ctx, db.ListForReaderByCreatedParams{
			UserID: userID, FeedID: feedIDPg, CategoryID: categoryIDPg,
			Filter: params.Filter, PageOffset: pageOffset, PageSize: readerPageSize,
		})
		entries = db.ReaderEntriesFromCreatedRows(rows)
	} else {
		rows, _ := s.q.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
			UserID: userID, FeedID: feedIDPg, CategoryID: categoryIDPg,
			Filter: params.Filter, PageOffset: pageOffset, PageSize: readerPageSize,
		})
		entries = db.ReaderEntriesFromPublishedRows(rows)
	}

	// Proxify favicon URLs in entries
	for i := range entries {
		proxified := s.faviconSvc.BuildProxifiedFaviconURL(entries[i].FaviconURL)
		entries[i].FaviconURL = &proxified
	}

	var entryData any = entries
	if entries == nil {
		entryData = []any{}
	}
	return Paginate(entryData, int(total), params.Page, readerPageSize)
}

// FetchCurrentEntry returns a single entry with interactions, applying read/unread
// state and proxifying images.
// markRead: nil=no change, true=mark read, false=mark unread
func (s *ReaderService) FetchCurrentEntry(ctx context.Context, userID int64, entryID int64, markRead *bool) (*db.ReaderEntry, error) {
	row, err := s.q.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: userID, EntryID: entryID})
	if err != nil {
		return nil, err
	}
	entry := db.ReaderEntryFromRow(&row)

	// Proxify favicon URL
	proxifiedFav := s.faviconSvc.BuildProxifiedFaviconURL(entry.FaviconURL)
	entry.FaviconURL = &proxifiedFav

	// Mark as read/unread
	if markRead != nil {
		if *markRead {
			_ = s.q.MarkAsRead(ctx, db.MarkAsReadParams{UserID: userID, EntryID: entryID})
			now := time.Now()
			entry.ReadAt = &now
		} else {
			_ = s.q.MarkAsUnread(ctx, db.MarkAsUnreadParams{UserID: userID, EntryID: entryID})
			entry.ReadAt = nil
		}
	}

	// Proxify images in content
	if entry.Content != nil {
		proxified := s.imgProxy.ProxifyImagesInHTML(*entry.Content)
		entry.Content = &proxified
	}

	return entry, nil
}

// SummarizeEntry returns a summary for the given entry.
func (s *ReaderService) SummarizeEntry(ctx context.Context, entryID int64) (any, error) {
	entry, err := s.q.FindEntryByID(ctx, entryID)
	if err != nil {
		return nil, err
	}
	return s.llm.SummarizeEntry(ctx, &entry)
}

// CountUnread returns the number of unread entries for the user.
func (s *ReaderService) CountUnread(ctx context.Context, userID int64) int64 {
	count, _ := s.q.CountUnread(ctx, userID)
	return count
}

// CountRead returns the number of read entries for the user.
func (s *ReaderService) CountRead(ctx context.Context, userID int64) int64 {
	count, _ := s.q.CountRead(ctx, userID)
	return count
}

// ListCategories returns the user's subscription categories.
func (s *ReaderService) ListCategories(ctx context.Context, userID int64) []db.SubscriptionCategory {
	cats, _ := s.q.ListCategoriesForUser(ctx, userID)
	return cats
}

// ListSubscriptions returns raw subscription rows for the user.
func (s *ReaderService) ListSubscriptions(ctx context.Context, userID int64) ([]db.ListSubscriptionsForUserRow, error) {
	return s.q.ListSubscriptionsForUser(ctx, userID)
}

// UnreadIDs returns the IDs of all unread entries for the user.
func (s *ReaderService) UnreadIDs(ctx context.Context, userID int64) ([]int64, error) {
	return s.q.UnreadIDs(ctx, userID)
}

// StarredIDs returns the IDs of all starred entries for the user.
func (s *ReaderService) StarredIDs(ctx context.Context, userID int64) ([]int64, error) {
	return s.q.StarredIDs(ctx, userID)
}

// ListEntries returns raw reader entries ordered by published date, with a total count.
func (s *ReaderService) ListEntries(ctx context.Context, userID int64, filter string, offset, limit int32) ([]db.ReaderEntry, int64, error) {
	rows, err := s.q.ListForReaderByPublished(ctx, db.ListForReaderByPublishedParams{
		UserID: userID, Filter: filter, PageOffset: offset, PageSize: limit,
	})
	if err != nil {
		return nil, 0, err
	}
	entries := db.ReaderEntriesFromPublishedRows(rows)
	total, err := s.q.CountForReader(ctx, db.CountForReaderParams{
		UserID: userID, Filter: filter,
	})
	if err != nil {
		return entries, 0, err
	}
	return entries, total, nil
}

// FindEntry returns a single reader entry without proxifying images or marking read.
func (s *ReaderService) FindEntry(ctx context.Context, userID int64, entryID int64) (*db.ReaderEntry, error) {
	row, err := s.q.FindReaderEntry(ctx, db.FindReaderEntryParams{UserID: userID, EntryID: entryID})
	if err != nil {
		return nil, err
	}
	entry := db.ReaderEntryFromRow(&row)
	return entry, nil
}

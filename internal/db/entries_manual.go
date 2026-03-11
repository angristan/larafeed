package db

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ReaderEntry is an entry with interaction data and feed info for the reader view.
type ReaderEntry struct {
	ID             int64      `json:"id"`
	FeedID         int64      `json:"-"` // included in nested feed object
	Title          string     `json:"title"`
	URL            string     `json:"url"`
	Author         *string    `json:"author"`
	Content        *string    `json:"content"`
	PublishedAt    time.Time  `json:"published_at"`
	ReadAt         *time.Time `json:"read_at"`
	StarredAt      *time.Time `json:"starred_at"`
	ArchivedAt     *time.Time `json:"archived_at"`
	FilteredAt     *time.Time `json:"filtered_at"`
	FeedName       string     `json:"-"` // included in nested feed object
	CustomFeedName *string    `json:"-"` // included in nested feed object
	FaviconURL     *string    `json:"-"` // included in nested feed object
	FaviconIsDark  *bool      `json:"-"` // included in nested feed object
}

// MarshalJSON nests feed-related fields into a "feed" sub-object to match
// the frontend Entry type: { feed: { id, name, favicon_url, favicon_is_dark } }
func (e ReaderEntry) MarshalJSON() ([]byte, error) {
	feedName := e.FeedName
	if e.CustomFeedName != nil && *e.CustomFeedName != "" {
		feedName = *e.CustomFeedName
	}

	type entryJSON struct {
		ID          int64      `json:"id"`
		Title       string     `json:"title"`
		URL         string     `json:"url"`
		Author      *string    `json:"author"`
		Content     *string    `json:"content"`
		PublishedAt time.Time  `json:"published_at"`
		ReadAt      *time.Time `json:"read_at"`
		StarredAt   *time.Time `json:"starred_at"`
		ArchivedAt  *time.Time `json:"archived_at"`
		FilteredAt  *time.Time `json:"filtered_at"`
		Feed        struct {
			ID            int64   `json:"id"`
			Name          string  `json:"name"`
			FaviconURL    *string `json:"favicon_url"`
			FaviconIsDark *bool   `json:"favicon_is_dark"`
		} `json:"feed"`
	}

	out := entryJSON{
		ID:          e.ID,
		Title:       e.Title,
		URL:         e.URL,
		Author:      e.Author,
		Content:     e.Content,
		PublishedAt: e.PublishedAt,
		ReadAt:      e.ReadAt,
		StarredAt:   e.StarredAt,
		ArchivedAt:  e.ArchivedAt,
		FilteredAt:  e.FilteredAt,
	}
	out.Feed.ID = e.FeedID
	out.Feed.Name = feedName
	out.Feed.FaviconURL = e.FaviconURL
	out.Feed.FaviconIsDark = e.FaviconIsDark

	return json.Marshal(out)
}

// ReaderEntryFromRow converts a sqlc-generated row to a ReaderEntry with custom JSON marshaling.
func ReaderEntryFromRow(r *FindReaderEntryRow) *ReaderEntry {
	return &ReaderEntry{
		ID: r.ID, FeedID: r.FeedID, Title: r.Title, URL: r.URL,
		Author: r.Author, Content: r.Content, PublishedAt: r.PublishedAt,
		ReadAt: r.ReadAt, StarredAt: r.StarredAt, ArchivedAt: r.ArchivedAt,
		FilteredAt: r.FilteredAt, FeedName: r.FeedName,
		CustomFeedName: r.CustomFeedName, FaviconURL: r.FaviconURL,
		FaviconIsDark: r.FaviconIsDark,
	}
}

// ReaderEntriesFromPublishedRows converts sqlc-generated rows to ReaderEntry slices.
func ReaderEntriesFromPublishedRows(rows []ListForReaderByPublishedRow) []ReaderEntry {
	entries := make([]ReaderEntry, len(rows))
	for i, r := range rows {
		entries[i] = ReaderEntry{
			ID: r.ID, FeedID: r.FeedID, Title: r.Title, URL: r.URL,
			Author: r.Author, Content: r.Content, PublishedAt: r.PublishedAt,
			ReadAt: r.ReadAt, StarredAt: r.StarredAt, ArchivedAt: r.ArchivedAt,
			FilteredAt: r.FilteredAt, FeedName: r.FeedName,
			CustomFeedName: r.CustomFeedName, FaviconURL: r.FaviconURL,
			FaviconIsDark: r.FaviconIsDark,
		}
	}
	return entries
}

// ReaderEntriesFromCreatedRows converts sqlc-generated rows to ReaderEntry slices.
func ReaderEntriesFromCreatedRows(rows []ListForReaderByCreatedRow) []ReaderEntry {
	entries := make([]ReaderEntry, len(rows))
	for i, r := range rows {
		entries[i] = ReaderEntry{
			ID: r.ID, FeedID: r.FeedID, Title: r.Title, URL: r.URL,
			Author: r.Author, Content: r.Content, PublishedAt: r.PublishedAt,
			ReadAt: r.ReadAt, StarredAt: r.StarredAt, ArchivedAt: r.ArchivedAt,
			FilteredAt: r.FilteredAt, FeedName: r.FeedName,
			CustomFeedName: r.CustomFeedName, FaviconURL: r.FaviconURL,
			FaviconIsDark: r.FaviconIsDark,
		}
	}
	return entries
}

// UserFeed is a feed with subscription metadata for the sidebar/reader.
type UserFeed = ListSubscriptionsForUserRow

// BulkCreate inserts entries in bulk, skipping duplicates.
func BulkCreate(ctx context.Context, pool *pgxpool.Pool, entries []Entry) ([]Entry, error) {
	if len(entries) == 0 {
		return nil, nil
	}

	query := `
		INSERT INTO entries (feed_id, title, url, author, content, published_at, created_at, updated_at)
		SELECT * FROM UNNEST($1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[], $7::timestamptz[], $8::timestamptz[])
		ON CONFLICT (feed_id, url, published_at) DO NOTHING
		RETURNING *`

	feedIDs := make([]int64, len(entries))
	titles := make([]string, len(entries))
	urls := make([]string, len(entries))
	authors := make([]*string, len(entries))
	contents := make([]*string, len(entries))
	publishedAts := make([]time.Time, len(entries))
	now := time.Now()
	createdAts := make([]time.Time, len(entries))
	updatedAts := make([]time.Time, len(entries))

	for i, e := range entries {
		feedIDs[i] = e.FeedID
		titles[i] = e.Title
		urls[i] = e.URL
		authors[i] = e.Author
		contents[i] = e.Content
		publishedAts[i] = e.PublishedAt
		createdAts[i] = now
		updatedAts[i] = now
	}

	rows, err := pool.Query(ctx, query, feedIDs, titles, urls, authors, contents, publishedAts, createdAts, updatedAts)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []Entry
	for rows.Next() {
		var e Entry
		err := rows.Scan(&e.ID, &e.FeedID, &e.Title, &e.URL, &e.Author, &e.Content,
			&e.PublishedAt, &e.CreatedAt, &e.UpdatedAt)
		if err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}

// MarkAllAsRead marks all unread entries for a feed as read (combines two sqlc queries).
func MarkAllAsRead(ctx context.Context, q *Queries, userID, feedID int64) error {
	if err := q.MarkAllAsReadExisting(ctx, MarkAllAsReadExistingParams{UserID: userID, FeedID: feedID}); err != nil {
		return err
	}
	return q.MarkAllAsReadNew(ctx, MarkAllAsReadNewParams{UserID: userID, FeedID: feedID})
}

// Token helpers that need crypto logic (not expressible in SQL).

// GeneratePlainToken and HashToken are re-exported from tokens_helpers.go.

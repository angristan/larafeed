package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/jackc/pgx/v5/pgtype"
	gonertia "github.com/romsar/gonertia/v2"
)

type ReaderHandler struct {
	inertia    *gonertia.Inertia
	q          *db.Queries
	llm        *service.LLMService
	imgProxy   *service.ImgProxyService
	faviconSvc *service.FaviconService
}

func NewReaderHandler(i *gonertia.Inertia, q *db.Queries, llm *service.LLMService, imgProxy *service.ImgProxyService, faviconSvc *service.FaviconService) *ReaderHandler {
	return &ReaderHandler{inertia: i, q: q, llm: llm, imgProxy: imgProxy, faviconSvc: faviconSvc}
}

func (h *ReaderHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	q := r.URL.Query()

	var feedID, categoryID *int64
	if v := q.Get("feed"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			feedID = &id
		}
	}
	if v := q.Get("category"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			categoryID = &id
		}
	}

	filter := q.Get("filter")
	if filter == "" {
		filter = "all"
	}
	orderBy := q.Get("order_by")
	if orderBy == "" {
		orderBy = "published_at"
	}
	page := 1
	if v := q.Get("page"); v != "" {
		if p, err := strconv.Atoi(v); err == nil && p > 0 {
			page = p
		}
	}

	props := gonertia.Props{}

	// Feeds — transform to match frontend Feed type
	feedRows, _ := h.q.ListSubscriptionsForUser(r.Context(), user.ID)
	type readerFeed struct {
		ID                      int64    `json:"id"`
		Name                    string   `json:"name"`
		OriginalName            string   `json:"original_name"`
		FaviconURL              string   `json:"favicon_url"`
		FaviconIsDark           *bool    `json:"favicon_is_dark"`
		SiteURL                 string   `json:"site_url"`
		FeedURL                 string   `json:"feed_url"`
		EntriesCount            int64    `json:"entries_count"`
		LastSuccessfulRefreshAt *string  `json:"last_successful_refresh_at"`
		LastFailedRefreshAt     *string  `json:"last_failed_refresh_at"`
		CategoryID              int64    `json:"category_id"`
		FilterRules             any      `json:"filter_rules"`
	}
	feeds := make([]readerFeed, len(feedRows))
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
		proxifiedFavicon := h.faviconSvc.BuildProxifiedFaviconURL(f.FaviconURL)
		feeds[i] = readerFeed{
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
	if feedRows == nil {
		props["feeds"] = []any{}
	} else {
		props["feeds"] = feeds
	}

	// Build pgtype.Int8 for nullable params
	var feedIDPg, categoryIDPg pgtype.Int8
	if feedID != nil {
		feedIDPg = pgtype.Int8{Int64: *feedID, Valid: true}
	}
	if categoryID != nil {
		categoryIDPg = pgtype.Int8{Int64: *categoryID, Valid: true}
	}

	// Count total
	total, _ := h.q.CountForReader(r.Context(), db.CountForReaderParams{
		UserID: user.ID, FeedID: feedIDPg, CategoryID: categoryIDPg, Filter: filter,
	})

	// Fetch entries
	pageOffset := int32((page - 1) * 30)
	var entries []db.ReaderEntry
	if orderBy == "created_at" {
		rows, _ := h.q.ListForReaderByCreated(r.Context(), db.ListForReaderByCreatedParams{
			UserID: user.ID, FeedID: feedIDPg, CategoryID: categoryIDPg,
			Filter: filter, PageOffset: pageOffset, PageSize: 30,
		})
		entries = db.ReaderEntriesFromCreatedRows(rows)
	} else {
		rows, _ := h.q.ListForReaderByPublished(r.Context(), db.ListForReaderByPublishedParams{
			UserID: user.ID, FeedID: feedIDPg, CategoryID: categoryIDPg,
			Filter: filter, PageOffset: pageOffset, PageSize: 30,
		})
		entries = db.ReaderEntriesFromPublishedRows(rows)
	}

	// Proxify favicon URLs in entries
	for i := range entries {
		proxified := h.faviconSvc.BuildProxifiedFaviconURL(entries[i].FaviconURL)
		entries[i].FaviconURL = &proxified
	}

	var entryData any = entries
	if entries == nil {
		entryData = []any{}
	}
	props["entries"] = service.Paginate(entryData, int(total), page, 30)

	// Current entry (deferred)
	props["currententry"] = gonertia.Defer(func() (any, error) {
		entryIDStr := q.Get("entry")
		if entryIDStr == "" {
			return nil, nil
		}
		entryID, err := strconv.ParseInt(entryIDStr, 10, 64)
		if err != nil {
			return nil, nil
		}
		row, err := h.q.FindReaderEntry(r.Context(), db.FindReaderEntryParams{UserID: user.ID, EntryID: entryID})
		if err != nil {
			return nil, nil
		}
		entry := db.ReaderEntryFromRow(&row)

		// Proxify favicon URL
		proxifiedFav := h.faviconSvc.BuildProxifiedFaviconURL(entry.FaviconURL)
		entry.FaviconURL = &proxifiedFav

		// Auto-mark as read/unread based on query param
		if readParam := q.Get("read"); readParam == "true" {
			_ = h.q.MarkAsRead(r.Context(), db.MarkAsReadParams{UserID: user.ID, EntryID: entryID})
			now := time.Now()
			entry.ReadAt = &now
		} else if readParam == "false" {
			_ = h.q.MarkAsUnread(r.Context(), db.MarkAsUnreadParams{UserID: user.ID, EntryID: entryID})
			entry.ReadAt = nil
		}

		// Proxify images
		if entry.Content != nil {
			proxified := h.imgProxy.ProxifyImagesInHTML(*entry.Content)
			entry.Content = &proxified
		}
		return entry, nil
	})

	// Unread count
	unreadCount, _ := h.q.CountUnread(r.Context(), user.ID)
	props["unreadEntriesCount"] = unreadCount

	// Read count
	readCount, _ := h.q.CountRead(r.Context(), user.ID)
	props["readEntriesCount"] = readCount

	// Summary (deferred, only if requested)
	props["summary"] = gonertia.Defer(func() (any, error) {
		if q.Get("summarize") != "true" {
			return nil, nil
		}
		entryIDStr := q.Get("entry")
		if entryIDStr == "" {
			return nil, nil
		}
		entryID, err := strconv.ParseInt(entryIDStr, 10, 64)
		if err != nil {
			return nil, nil
		}
		entry, err := h.q.FindEntryByID(r.Context(), entryID)
		if err != nil {
			return nil, nil
		}
		return h.llm.SummarizeEntry(r.Context(), &entry)
	})

	// Categories
	cats, _ := h.q.ListCategoriesForUser(r.Context(), user.ID)
	if cats == nil {
		props["categories"] = []any{}
	} else {
		props["categories"] = cats
	}

	if err := h.inertia.Render(w, r, "Reader/Reader", props); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

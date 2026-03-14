package handler

import (
	"net/http"
	"strconv"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/service"
	gonertia "github.com/romsar/gonertia/v2"
)

type ReaderHandler struct {
	inertia   *gonertia.Inertia
	readerSvc readerService
}

func NewReaderHandler(i *gonertia.Inertia, readerSvc readerService) *ReaderHandler {
	return &ReaderHandler{inertia: i, readerSvc: readerSvc}
}

func (h *ReaderHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	q := r.URL.Query()

	// Parse query parameters
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

	params := service.ReaderQuery{
		FeedID: feedID, CategoryID: categoryID,
		Filter: filter, OrderBy: orderBy, Page: page,
	}

	props := gonertia.Props{}

	// Feeds
	feeds := h.readerSvc.ListFeeds(r.Context(), user.ID)
	if feeds == nil {
		props["feeds"] = []any{}
	} else {
		props["feeds"] = feeds
	}

	// Entries (paginated)
	props["entries"] = h.readerSvc.FetchEntriesPage(r.Context(), user.ID, params)

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

		var markRead *bool
		if readParam := q.Get("read"); readParam == "true" {
			t := true
			markRead = &t
		} else if readParam == "false" {
			f := false
			markRead = &f
		}

		entry, err := h.readerSvc.FetchCurrentEntry(r.Context(), user.ID, entryID, markRead)
		if err != nil {
			return nil, nil
		}
		return entry, nil
	})

	// Counts
	props["unreadEntriesCount"] = h.readerSvc.CountUnread(r.Context(), user.ID)
	props["readEntriesCount"] = h.readerSvc.CountRead(r.Context(), user.ID)

	// Summary (deferred)
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
		return h.readerSvc.SummarizeEntry(r.Context(), entryID)
	})

	// Categories
	cats := h.readerSvc.ListCategories(r.Context(), user.ID)
	if cats == nil {
		props["categories"] = []any{}
	} else {
		props["categories"] = cats
	}

	if err := h.inertia.Render(w, r, "Reader/Reader", props); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

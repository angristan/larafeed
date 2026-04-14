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
		id, parseErr := strconv.ParseInt(v, 10, 64)
		if parseErr == nil {
			feedID = &id
		}
	}
	if v := q.Get("category"); v != "" {
		id, parseErr := strconv.ParseInt(v, 10, 64)
		if parseErr == nil {
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
		p, parseErr := strconv.Atoi(v)
		if parseErr == nil && p > 0 {
			page = p
		}
	}

	params := service.ReaderQuery{
		FeedID: feedID, CategoryID: categoryID,
		Filter: filter, OrderBy: orderBy, Page: page,
	}

	props := gonertia.Props{}

	// Determine which props the client actually needs.
	// On partial reloads (prefetch/click), Inertia sends X-Inertia-Partial-Data
	// with only the requested prop names, so we skip expensive queries for the rest.
	partialOnly := partialProps(r)

	needsProp := func(name string) bool {
		if len(partialOnly) == 0 {
			return true // full page load — compute everything
		}
		_, ok := partialOnly[name]
		return ok
	}

	// Feeds
	if needsProp("feeds") {
		feeds, err := h.readerSvc.ListFeeds(r.Context(), user.ID)
		if err != nil {
			renderError(w, r, h.inertia, http.StatusInternalServerError, err)
			return
		}
		if feeds == nil {
			props["feeds"] = []any{}
		} else {
			props["feeds"] = feeds
		}
	}

	// Entries (paginated)
	if needsProp("entries") {
		entries, err := h.readerSvc.FetchEntriesPage(r.Context(), user.ID, params)
		if err != nil {
			renderError(w, r, h.inertia, http.StatusInternalServerError, err)
			return
		}
		props["entries"] = entries
	}

	// Current entry
	if needsProp("currententry") {
		var currentEntry any
		if entryIDStr := q.Get("entry"); entryIDStr != "" {
			entryID, parseErr := strconv.ParseInt(entryIDStr, 10, 64)
			if parseErr == nil {
				var markRead *bool
				if readParam := q.Get("read"); readParam == "true" {
					t := true
					markRead = &t
				} else if readParam == "false" {
					f := false
					markRead = &f
				}

				entry, fetchErr := h.readerSvc.FetchCurrentEntry(r.Context(), user.ID, entryID, markRead)
				if fetchErr == nil {
					currentEntry = entry
				}
			}
		}
		props["currententry"] = currentEntry
	}

	// Counts
	if needsProp("unreadEntriesCount") || needsProp("readEntriesCount") {
		unread, err := h.readerSvc.CountUnread(r.Context(), user.ID)
		if err != nil {
			renderError(w, r, h.inertia, http.StatusInternalServerError, err)
			return
		}
		read, err := h.readerSvc.CountRead(r.Context(), user.ID)
		if err != nil {
			renderError(w, r, h.inertia, http.StatusInternalServerError, err)
			return
		}
		props["unreadEntriesCount"] = unread
		props["readEntriesCount"] = read
	}

	// Summary (deferred)
	if needsProp("summary") {
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
	}

	// Categories
	if needsProp("categories") {
		cats, err := h.readerSvc.ListCategories(r.Context(), user.ID)
		if err != nil {
			renderError(w, r, h.inertia, http.StatusInternalServerError, err)
			return
		}
		if cats == nil {
			props["categories"] = []any{}
		} else {
			props["categories"] = cats
		}
	}

	err := h.inertia.Render(w, r, "Reader/Reader", props)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError, err)
	}
}

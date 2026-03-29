package api

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
)

type FeverHandler struct {
	authSvc feverAuthService
	reader  readerService
	entries entryService
}

func NewFeverHandler(authSvc feverAuthService, reader readerService, entries entryService) *FeverHandler {
	return &FeverHandler{authSvc: authSvc, reader: reader, entries: entries}
}

// CheckToken is middleware for Fever API authentication.
func (h *FeverHandler) CheckToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		err := r.ParseForm()
		if err != nil {
			feverResponse(w, map[string]any{"api_version": 3, "auth": 0})
			return
		}
		apiKey := r.FormValue("api_key")
		if apiKey == "" {
			feverResponse(w, map[string]any{"api_version": 3, "auth": 0})
			return
		}

		user, err := h.authSvc.FindUserByFeverApiKey(r.Context(), &apiKey)
		if err != nil {
			feverResponse(w, map[string]any{"api_version": 3, "auth": 0})
			return
		}

		ctx := auth.SetUserInContext(r.Context(), user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *FeverHandler) Handle(w http.ResponseWriter, r *http.Request) {
	err := r.ParseForm()
	if err != nil {
		slog.WarnContext(r.Context(), "failed to parse form", "error", err)
	}
	user := auth.UserFromRequest(r)
	q := r.URL.Query()

	base := map[string]any{
		"api_version":            3,
		"auth":                   1,
		"last_refreshed_on_time": time.Now().Unix(),
	}

	if q.Has("groups") {
		h.getGroups(r, user, base)
	}
	if q.Has("feeds") {
		h.getFeeds(r, user, base)
	}
	if q.Has("items") {
		h.getItems(r, user, base)
	}
	if q.Has("unread_item_ids") {
		h.getUnreadItemIDs(r, user, base)
	}
	if q.Has("saved_item_ids") {
		h.getSavedItemIDs(r, user, base)
	}
	if q.Get("mark") != "" {
		h.updateItem(r, user, q)
	}

	feverResponse(w, base)
}

func (h *FeverHandler) getGroups(r *http.Request, user *db.User, base map[string]any) {
	cats, err := h.reader.ListCategories(r.Context(), user.ID)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to list categories", "error", err)
	}
	feeds, err := h.reader.ListSubscriptions(r.Context(), user.ID)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to list subscriptions", "error", err)
	}

	var groups []map[string]any
	for _, c := range cats {
		groups = append(groups, map[string]any{"id": c.ID, "title": c.Name})
	}

	// Group feed IDs by category
	catFeeds := map[int64][]string{}
	for _, f := range feeds {
		catFeeds[f.CategoryID] = append(catFeeds[f.CategoryID], strconv.FormatInt(f.ID, 10))
	}

	var feedsGroups []map[string]any
	for catID, feedIDs := range catFeeds {
		feedsGroups = append(feedsGroups, map[string]any{
			"group_id": catID,
			"feed_ids": strings.Join(feedIDs, ","),
		})
	}

	base["groups"] = groups
	base["feeds_groups"] = feedsGroups
}

func (h *FeverHandler) getFeeds(r *http.Request, user *db.User, base map[string]any) {
	feeds, err := h.reader.ListSubscriptions(r.Context(), user.ID)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to list subscriptions", "error", err)
	}

	var result []map[string]any
	for _, f := range feeds {
		title := f.Name
		if f.CustomFeedName != nil {
			title = *f.CustomFeedName
		}
		var lastUpdated int64
		if f.LastSuccessfulRefreshAt != nil {
			lastUpdated = f.LastSuccessfulRefreshAt.Unix()
		}
		faviconID := ""
		if f.FaviconURL != nil {
			faviconID = *f.FaviconURL
		}
		result = append(result, map[string]any{
			"id":                    f.ID,
			"favicon_id":           faviconID,
			"title":                title,
			"url":                  f.FeedURL,
			"site_url":             f.SiteURL,
			"is_spark":             0,
			"last_updated_on_time": lastUpdated,
		})
	}

	// Reuse groups logic for feeds_groups
	catFeeds := map[int64][]string{}
	for _, f := range feeds {
		catFeeds[f.CategoryID] = append(catFeeds[f.CategoryID], strconv.FormatInt(f.ID, 10))
	}
	var feedsGroups []map[string]any
	for catID, feedIDs := range catFeeds {
		feedsGroups = append(feedsGroups, map[string]any{
			"group_id": catID,
			"feed_ids": strings.Join(feedIDs, ","),
		})
	}

	base["feeds"] = result
	base["feeds_groups"] = feedsGroups
}

func (h *FeverHandler) getItems(r *http.Request, user *db.User, base map[string]any) {
	entries, total, err := h.reader.ListEntries(r.Context(), user.ID, "all", 0, 50)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to list entries", "error", err)
	}

	var items []map[string]any
	for _, e := range entries {
		content := ""
		if e.Content != nil {
			content = *e.Content
		}
		author := ""
		if e.Author != nil {
			author = *e.Author
		}
		items = append(items, map[string]any{
			"id":              e.ID,
			"feed_id":        e.FeedID,
			"title":          e.Title,
			"author":         author,
			"html":           content,
			"url":            e.URL,
			"is_saved":       e.StarredAt != nil,
			"is_read":        e.ReadAt != nil,
			"created_on_time": e.PublishedAt.Unix(),
		})
	}

	base["items"] = items
	base["total_items"] = total
}

func (h *FeverHandler) getUnreadItemIDs(r *http.Request, user *db.User, base map[string]any) {
	ids, err := h.reader.UnreadIDs(r.Context(), user.ID)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to get unread IDs", "error", err)
	}
	base["unread_item_ids"] = joinIDs(ids)
}

func (h *FeverHandler) getSavedItemIDs(r *http.Request, user *db.User, base map[string]any) {
	ids, err := h.reader.StarredIDs(r.Context(), user.ID)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to get starred IDs", "error", err)
	}
	base["saved_item_ids"] = joinIDs(ids)
}

func (h *FeverHandler) updateItem(r *http.Request, user *db.User, q map[string][]string) {
	idStr := getFirst(q, "id")
	action := getFirst(q, "as")
	if idStr == "" {
		idStr = r.FormValue("id")
	}
	if action == "" {
		action = r.FormValue("as")
	}

	entryID, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || entryID == 0 {
		return
	}

	var read, starred *bool
	switch action {
	case "saved":
		starred = ptrBool(true)
	case "unsaved":
		starred = ptrBool(false)
	case "read":
		read = ptrBool(true)
	case "unread":
		read = ptrBool(false)
	}
	err = h.entries.UpdateInteractions(r.Context(), user.ID, entryID, read, starred, nil)
	if err != nil {
		slog.WarnContext(r.Context(), "fever: failed to update interactions", "error", err, "entry_id", entryID)
	}
}

func feverResponse(w http.ResponseWriter, data map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(data)
	if err != nil {
		slog.Error("failed to write Fever response", "error", err)
	}
}

func joinIDs(ids []int64) string {
	strs := make([]string, len(ids))
	for i, id := range ids {
		strs[i] = fmt.Sprintf("%d", id)
	}
	return strings.Join(strs, ",")
}

func getFirst(q map[string][]string, key string) string {
	if vals, ok := q[key]; ok && len(vals) > 0 {
		return vals[0]
	}
	return ""
}

func ptrBool(b bool) *bool { return &b }

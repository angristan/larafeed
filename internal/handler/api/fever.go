package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
)

type FeverHandler struct {
	q *db.Queries
}

func NewFeverHandler(q *db.Queries) *FeverHandler {
	return &FeverHandler{q: q}
}

// CheckToken is middleware for Fever API authentication.
func (h *FeverHandler) CheckToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		apiKey := r.FormValue("api_key")
		if apiKey == "" {
			feverResponse(w, map[string]any{"api_version": 3, "auth": 0})
			return
		}

		user, err := h.q.FindUserByFeverApiKey(r.Context(), &apiKey)
		if err != nil {
			feverResponse(w, map[string]any{"api_version": 3, "auth": 0})
			return
		}

		ctx := auth.SetUserInContext(r.Context(), &user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *FeverHandler) Handle(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	user := auth.UserFromRequest(r)
	q := r.URL.Query()

	base := map[string]any{
		"api_version":          3,
		"auth":                 1,
		"last_refreshed_on_time": time.Now().Unix(),
	}

	if q.Has("groups") {
		h.getGroups(r, user, base)
	}
	if q.Has("feeds") {
		h.getFeeds(r, user, base)
	}
	if q.Has("items") {
		h.getItems(r, user, q, base)
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
	cats, _ := h.q.ListCategoriesForUser(r.Context(), user.ID)
	feeds, _ := h.q.ListSubscriptionsForUser(r.Context(), user.ID)

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
	feeds, _ := h.q.ListSubscriptionsForUser(r.Context(), user.ID)

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
			"id":                     f.ID,
			"favicon_id":            faviconID,
			"title":                 title,
			"url":                   f.FeedURL,
			"site_url":              f.SiteURL,
			"is_spark":              0,
			"last_updated_on_time":  lastUpdated,
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

func (h *FeverHandler) getItems(r *http.Request, user *db.User, q map[string][]string, base map[string]any) {
	rows, _ := h.q.ListForReaderByPublished(r.Context(), db.ListForReaderByPublishedParams{
		UserID: user.ID, Filter: "all", PageOffset: 0, PageSize: 50,
	})
	entries := db.ReaderEntriesFromPublishedRows(rows)
	total, _ := h.q.CountForReader(r.Context(), db.CountForReaderParams{
		UserID: user.ID, Filter: "all",
	})

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
	ids, _ := h.q.UnreadIDs(r.Context(), user.ID)
	base["unread_item_ids"] = joinIDs(ids)
}

func (h *FeverHandler) getSavedItemIDs(r *http.Request, user *db.User, base map[string]any) {
	ids, _ := h.q.StarredIDs(r.Context(), user.ID)
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

	switch action {
	case "saved":
		_ = h.q.Favorite(r.Context(), db.FavoriteParams{UserID: user.ID, EntryID: entryID})
	case "unsaved":
		_ = h.q.Unfavorite(r.Context(), db.UnfavoriteParams{UserID: user.ID, EntryID: entryID})
	case "read":
		_ = h.q.MarkAsRead(r.Context(), db.MarkAsReadParams{UserID: user.ID, EntryID: entryID})
	case "unread":
		_ = h.q.MarkAsUnread(r.Context(), db.MarkAsUnreadParams{UserID: user.ID, EntryID: entryID})
	}
}

func feverResponse(w http.ResponseWriter, data map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
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

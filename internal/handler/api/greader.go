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

type GoogleReaderHandler struct {
	q *db.Queries
}

func NewGoogleReaderHandler(q *db.Queries) *GoogleReaderHandler {
	return &GoogleReaderHandler{q: q}
}

// CheckToken is middleware that validates the Google Reader auth token.
func (h *GoogleReaderHandler) CheckToken(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		if !strings.HasPrefix(authHeader, "GoogleLogin auth=") {
			http.Error(w, "Error=AuthRequired", http.StatusUnauthorized)
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "GoogleLogin auth=")
		token, err := h.q.FindPersonalAccessToken(r.Context(), db.HashToken(tokenStr))
		if err != nil || token.Abilities == nil || !strings.Contains(*token.Abilities, "reader-api") {
			http.Error(w, "Error=InvalidAuthToken", http.StatusForbidden)
			return
		}

		_ = h.q.TouchTokenLastUsed(r.Context(), token.ID)

		user, err := h.q.FindUserByID(r.Context(), token.TokenableID)
		if err != nil {
			http.Error(w, "Error=InvalidAuthToken", http.StatusForbidden)
			return
		}

		ctx := auth.SetUserInContext(r.Context(), &user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *GoogleReaderHandler) ClientLogin(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Error=BadAuthentication", http.StatusForbidden)
		return
	}

	email := r.FormValue("Email")
	password := r.FormValue("Passwd")

	user, err := h.q.FindUserByEmail(r.Context(), email)
	if err != nil || !auth.CheckPassword(user.Password, password) {
		http.Error(w, "Error=BadAuthentication", http.StatusForbidden)
		return
	}

	// Delete old tokens
	_ = h.q.DeleteUserTokens(r.Context(), db.DeleteUserTokensParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
	})

	// Create new token
	plain := db.GeneratePlainToken(40)
	abilities := "[\"reader-api\"]"
	err = h.q.CreatePersonalAccessToken(r.Context(), db.CreatePersonalAccessTokenParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
		Name:          "reader-auth-token",
		Token:         db.HashToken(plain),
		Abilities:     &abilities,
	})
	if err != nil {
		http.Error(w, "Error=ServerError", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"Auth": plain,
		"SID":  plain,
		"LSID": plain,
	})
}

func (h *GoogleReaderHandler) GetToken(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "GoogleLogin auth=")
	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, token)
}

func (h *GoogleReaderHandler) GetUserInfo(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"userId":        strconv.FormatInt(user.ID, 10),
		"userName":      user.Name,
		"userEmail":     user.Email,
		"userProfileId": strconv.FormatInt(user.ID, 10),
	})
}

func (h *GoogleReaderHandler) GetSubscriptionList(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feeds, err := h.q.ListSubscriptionsForUser(r.Context(), user.ID)
	if err != nil {
		http.Error(w, "Error", http.StatusInternalServerError)
		return
	}

	type Sub struct {
		ID         string `json:"id"`
		URL        string `json:"url"`
		HTMLURL    string `json:"htmlUrl"`
		Title      string `json:"title"`
		Categories []struct {
			ID    string `json:"id"`
			Label string `json:"label"`
			Type  string `json:"type"`
		} `json:"categories"`
		IconURL string `json:"iconUrl"`
	}

	var subs []Sub
	for _, f := range feeds {
		title := f.Name
		if f.CustomFeedName != nil {
			title = *f.CustomFeedName
		}
		subs = append(subs, Sub{
			ID:      fmt.Sprintf("feed/%d", f.ID),
			URL:     f.FeedURL,
			HTMLURL: f.SiteURL,
			Title:   title,
			Categories: []struct {
				ID    string `json:"id"`
				Label string `json:"label"`
				Type  string `json:"type"`
			}{
				{
					ID:    fmt.Sprintf("user/%d/label/%s", user.ID, f.CategoryName),
					Label: f.CategoryName,
					Type:  "folder",
				},
			},
			IconURL: "",
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"subscriptions": subs})
}

func (h *GoogleReaderHandler) GetStreamItemIds(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	q := r.URL.Query()
	stream := q.Get("s")
	exclude := q.Get("xt")

	var ids []int64
	var err error

	switch {
	case stream == "user/-/state/com.google/starred":
		ids, err = h.q.StarredIDs(r.Context(), user.ID)
	case exclude == "user/-/state/com.google/read":
		ids, err = h.q.UnreadIDs(r.Context(), user.ID)
	default:
		// All items - return entries for user
		rows, err2 := h.q.ListForReaderByPublished(r.Context(), db.ListForReaderByPublishedParams{
			UserID: user.ID, Filter: "all", PageOffset: 0, PageSize: 10000,
		})
		err = err2
		for _, e := range rows {
			ids = append(ids, e.ID)
		}
	}

	if err != nil {
		http.Error(w, "Error", http.StatusInternalServerError)
		return
	}

	type ItemRef struct {
		ID string `json:"id"`
	}
	var refs []ItemRef
	for _, id := range ids {
		refs = append(refs, ItemRef{ID: fmt.Sprintf("%d", id)})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"itemRefs": refs})
}

func (h *GoogleReaderHandler) GetStreamContents(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	hexIDs := r.Form["i"]

	type Item struct {
		ID              string            `json:"id"`
		Title           string            `json:"title"`
		TimestampUsec   string            `json:"timestampUsec"`
		CrawlTimeMsec  string            `json:"crawlTimeMsec"`
		Published       int64             `json:"published"`
		Updated         int64             `json:"updated"`
		Alternate       []map[string]string `json:"alternate"`
		Content         map[string]string `json:"content"`
		Origin          map[string]string `json:"origin"`
		Categories      []string          `json:"categories"`
		Canonical       []map[string]string `json:"canonical"`
		Author          string            `json:"author,omitempty"`
	}

	var items []Item
	for _, hexID := range hexIDs {
		entryID, err := strconv.ParseInt(hexID, 16, 64)
		if err != nil {
			entryID, _ = strconv.ParseInt(hexID, 10, 64)
		}
		if entryID == 0 {
			continue
		}

		row, err := h.q.FindReaderEntry(r.Context(), db.FindReaderEntryParams{UserID: user.ID, EntryID: entryID})
		if err != nil {
			continue
		}
		entry := db.ReaderEntryFromRow(&row)

		content := ""
		if entry.Content != nil {
			content = *entry.Content
		}
		authorStr := ""
		if entry.Author != nil {
			authorStr = *entry.Author
		}

		categories := []string{
			fmt.Sprintf("user/%d/state/com.google/reading-list", user.ID),
		}
		if entry.ReadAt != nil {
			categories = append(categories, fmt.Sprintf("user/%d/state/com.google/read", user.ID))
		}
		if entry.StarredAt != nil {
			categories = append(categories, fmt.Sprintf("user/%d/state/com.google/starred", user.ID))
		}

		hexEntryID := fmt.Sprintf("%016x", entry.ID)
		items = append(items, Item{
			ID:             fmt.Sprintf("tag:google.com,2005:reader/item/%s", hexEntryID),
			Title:          entry.Title,
			TimestampUsec:  fmt.Sprintf("%d", entry.PublishedAt.UnixMicro()),
			CrawlTimeMsec: fmt.Sprintf("%d", entry.PublishedAt.UnixMilli()),
			Published:      entry.PublishedAt.Unix(),
			Updated:        entry.PublishedAt.Unix(),
			Alternate:      []map[string]string{{"href": entry.URL, "type": "text/html"}},
			Content:        map[string]string{"direction": "ltr", "content": content},
			Origin: map[string]string{
				"streamId": fmt.Sprintf("feed/%d", entry.FeedID),
				"title":    entry.FeedName,
			},
			Categories: categories,
			Canonical:  []map[string]string{{"href": entry.URL}},
			Author:     authorStr,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"items":   items,
		"updated": time.Now().Unix(),
	})
}

func (h *GoogleReaderHandler) EditTag(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	hexID := r.FormValue("i")
	addTag := r.FormValue("a")
	removeTag := r.FormValue("r")

	entryID, err := strconv.ParseInt(hexID, 16, 64)
	if err != nil {
		entryID, _ = strconv.ParseInt(hexID, 10, 64)
	}
	if entryID == 0 {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	switch {
	case addTag == "user/-/state/com.google/read":
		_ = h.q.MarkAsRead(r.Context(), db.MarkAsReadParams{UserID: user.ID, EntryID: entryID})
	case removeTag == "user/-/state/com.google/read":
		_ = h.q.MarkAsUnread(r.Context(), db.MarkAsUnreadParams{UserID: user.ID, EntryID: entryID})
	case addTag == "user/-/state/com.google/starred":
		_ = h.q.Favorite(r.Context(), db.FavoriteParams{UserID: user.ID, EntryID: entryID})
	case removeTag == "user/-/state/com.google/starred":
		_ = h.q.Unfavorite(r.Context(), db.UnfavoriteParams{UserID: user.ID, EntryID: entryID})
	}

	w.Header().Set("Content-Type", "text/plain")
	fmt.Fprint(w, "OK")
}

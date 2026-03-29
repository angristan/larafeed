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

type GoogleReaderHandler struct {
	authSvc greaderAuthService
	reader  readerService
	entries entryService
}

func NewGoogleReaderHandler(authSvc greaderAuthService, reader readerService, entries entryService) *GoogleReaderHandler {
	return &GoogleReaderHandler{authSvc: authSvc, reader: reader, entries: entries}
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
		user, err := h.authSvc.AuthenticateReaderToken(r.Context(), db.HashToken(tokenStr))
		if err != nil {
			http.Error(w, "Error=InvalidAuthToken", http.StatusForbidden)
			return
		}

		ctx := auth.SetUserInContext(r.Context(), user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (h *GoogleReaderHandler) ClientLogin(w http.ResponseWriter, r *http.Request) {
	err := r.ParseForm()
	if err != nil {
		http.Error(w, "Error=BadAuthentication", http.StatusForbidden)
		return
	}

	email := r.FormValue("Email")
	password := r.FormValue("Passwd")

	plain, err := h.authSvc.CreateReaderSession(r.Context(), email, password)
	if err != nil {
		http.Error(w, "Error=BadAuthentication", http.StatusForbidden)
		return
	}

	greaderJSON(w, r, map[string]string{
		"Auth": plain,
		"SID":  plain,
		"LSID": plain,
	})
}

func (h *GoogleReaderHandler) GetToken(w http.ResponseWriter, r *http.Request) {
	authHeader := r.Header.Get("Authorization")
	token := strings.TrimPrefix(authHeader, "GoogleLogin auth=")
	w.Header().Set("Content-Type", "text/plain")
	_, err := fmt.Fprint(w, token)
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to write response", "error", err)
	}
}

func (h *GoogleReaderHandler) GetUserInfo(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	greaderJSON(w, r, map[string]string{
		"userId":        strconv.FormatInt(user.ID, 10),
		"userName":      user.Name,
		"userEmail":     user.Email,
		"userProfileId": strconv.FormatInt(user.ID, 10),
	})
}

func (h *GoogleReaderHandler) GetSubscriptionList(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feeds, err := h.reader.ListSubscriptions(r.Context(), user.ID)
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

	greaderJSON(w, r, map[string]any{"subscriptions": subs})
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
		ids, err = h.reader.StarredIDs(r.Context(), user.ID)
	case exclude == "user/-/state/com.google/read":
		ids, err = h.reader.UnreadIDs(r.Context(), user.ID)
	default:
		// All items - return entries for user
		var entries []db.ReaderEntry
		entries, _, err = h.reader.ListEntries(r.Context(), user.ID, "all", 0, 10000)
		for _, e := range entries {
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

	greaderJSON(w, r, map[string]any{"itemRefs": refs})
}

func (h *GoogleReaderHandler) GetStreamContents(w http.ResponseWriter, r *http.Request) {
	err := r.ParseForm()
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	hexIDs := r.Form["i"]

	type Item struct {
		ID             string              `json:"id"`
		Title          string              `json:"title"`
		TimestampUsec  string              `json:"timestampUsec"`
		CrawlTimeMsec string              `json:"crawlTimeMsec"`
		Published      int64               `json:"published"`
		Updated        int64               `json:"updated"`
		Alternate      []map[string]string `json:"alternate"`
		Content        map[string]string   `json:"content"`
		Origin         map[string]string   `json:"origin"`
		Categories     []string            `json:"categories"`
		Canonical      []map[string]string `json:"canonical"`
		Author         string              `json:"author,omitempty"`
	}

	var items []Item
	for _, hexID := range hexIDs {
		entryID, err := strconv.ParseInt(hexID, 16, 64)
		if err != nil {
			var parseErr error
			entryID, parseErr = strconv.ParseInt(hexID, 10, 64)
			if parseErr != nil {
				continue
			}
		}
		if entryID == 0 {
			continue
		}

		entry, err := h.reader.FindEntry(r.Context(), user.ID, entryID)
		if err != nil {
			continue
		}

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
			ID:            fmt.Sprintf("tag:google.com,2005:reader/item/%s", hexEntryID),
			Title:         entry.Title,
			TimestampUsec: fmt.Sprintf("%d", entry.PublishedAt.UnixMicro()),
			CrawlTimeMsec: fmt.Sprintf("%d", entry.PublishedAt.UnixMilli()),
			Published:     entry.PublishedAt.Unix(),
			Updated:       entry.PublishedAt.Unix(),
			Alternate:     []map[string]string{{"href": entry.URL, "type": "text/html"}},
			Content:       map[string]string{"direction": "ltr", "content": content},
			Origin: map[string]string{
				"streamId": fmt.Sprintf("feed/%d", entry.FeedID),
				"title":    entry.FeedName,
			},
			Categories: categories,
			Canonical:  []map[string]string{{"href": entry.URL}},
			Author:     authorStr,
		})
	}

	greaderJSON(w, r, map[string]any{
		"items":   items,
		"updated": time.Now().Unix(),
	})
}

func (h *GoogleReaderHandler) EditTag(w http.ResponseWriter, r *http.Request) {
	err := r.ParseForm()
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	hexID := r.FormValue("i")
	addTag := r.FormValue("a")
	removeTag := r.FormValue("r")

	entryID, err := strconv.ParseInt(hexID, 16, 64)
	if err != nil {
		var parseErr error
		entryID, parseErr = strconv.ParseInt(hexID, 10, 64)
		if parseErr != nil {
			http.Error(w, "Invalid ID", http.StatusBadRequest)
			return
		}
	}
	if entryID == 0 {
		http.Error(w, "Invalid ID", http.StatusBadRequest)
		return
	}

	var read, starred *bool
	switch {
	case addTag == "user/-/state/com.google/read":
		read = ptrBool(true)
	case removeTag == "user/-/state/com.google/read":
		read = ptrBool(false)
	case addTag == "user/-/state/com.google/starred":
		starred = ptrBool(true)
	case removeTag == "user/-/state/com.google/starred":
		starred = ptrBool(false)
	}

	err = h.entries.UpdateInteractions(r.Context(), user.ID, entryID, read, starred, nil)
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to update entry interactions", "entry_id", entryID, "error", err)
	}

	w.Header().Set("Content-Type", "text/plain")
	_, err = fmt.Fprint(w, "OK")
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to write response", "error", err)
	}
}

func greaderJSON(w http.ResponseWriter, r *http.Request, data any) {
	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(data)
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to write Google Reader response", "error", err)
	}
}

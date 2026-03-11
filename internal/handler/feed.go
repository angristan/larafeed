package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	gonertia "github.com/romsar/gonertia/v2"
)

type FeedHandler struct {
	inertia    *gonertia.Inertia
	pool       *db.Pool
	q          *db.Queries
	feedService *service.FeedService
	faviconSvc *service.FaviconService
	filter     *service.FilterService
}

func NewFeedHandler(i *gonertia.Inertia, pool *db.Pool, q *db.Queries, feedSvc *service.FeedService, faviconSvc *service.FaviconService, filter *service.FilterService) *FeedHandler {
	return &FeedHandler{
		inertia: i, pool: pool, q: q,
		feedService: feedSvc, faviconSvc: faviconSvc, filter: filter,
	}
}

func (h *FeedHandler) Create(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	feedURL := strings.TrimSpace(form.Get("feed_url"))

	errors := map[string]string{}
	if feedURL == "" {
		errors["feed_url"] = "The feed URL is required."
	}

	// Determine category
	var categoryID int64
	if catIDStr := form.Get("category_id"); catIDStr != "" {
		id, err := strconv.ParseInt(catIDStr, 10, 64)
		if err == nil {
			categoryID = id
		}
	} else if catName := form.Get("category_name"); catName != "" {
		cat, err := h.q.FindOrCreateCategory(r.Context(), db.FindOrCreateCategoryParams{UserID: user.ID, Name: catName})
		if err != nil {
			errors["category_name"] = "Could not create category."
		} else {
			categoryID = cat.ID
		}
	}

	if categoryID == 0 && len(errors) == 0 {
		errors["category_id"] = "A category is required."
	}

	if len(errors) > 0 {
		validationError(w, r, h.inertia, errors)
		return
	}

	feed, err := h.feedService.CreateFeed(r.Context(), user.ID, feedURL, categoryID, "")
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"feed_url": err.Error()})
		return
	}

	// Fetch favicon in background
	go func() {
		_ = h.faviconSvc.RefreshFavicon(r.Context(), feed)
	}()

	http.Redirect(w, r, "/feeds?feed="+strconv.FormatInt(feed.ID, 10), http.StatusFound)
}

func (h *FeedHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	err = db.WithTx(r.Context(), h.pool, func(ctx context.Context, tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `DELETE FROM entry_interactions WHERE user_id = $1 AND entry_id IN (SELECT id FROM entries WHERE feed_id = $2)`, user.ID, feedID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM feed_subscriptions WHERE user_id = $1 AND feed_id = $2`, user.ID, feedID); err != nil {
			return err
		}
		// Delete feed if no more subscribers
		var count int
		if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM feed_subscriptions WHERE feed_id = $1`, feedID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			if _, err := tx.Exec(ctx, `DELETE FROM feeds WHERE id = $1`, feedID); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		http.Error(w, "Failed to unsubscribe", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *FeedHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	feed, err := h.q.FindFeedByID(r.Context(), feedID)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Feed not found"})
		return
	}

	// Rate limit: 5 minutes between refreshes
	if feed.LastSuccessfulRefreshAt != nil && time.Since(*feed.LastSuccessfulRefreshAt) < 5*time.Minute {
		jsonResponse(w, http.StatusTooManyRequests, map[string]string{"message": "Feed has already been refreshed less than 5min ago"})
		return
	}

	newCount, err := h.feedService.RefreshFeed(r.Context(), &feed)
	if err != nil {
		jsonResponse(w, http.StatusOK, map[string]any{"success": false, "error": err.Error()})
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "new_entries": newCount})
}

func (h *FeedHandler) RefreshFavicon(w http.ResponseWriter, r *http.Request) {
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	feed, err := h.q.FindFeedByID(r.Context(), feedID)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Feed not found"})
		return
	}

	go func() {
		_ = h.faviconSvc.RefreshFavicon(r.Context(), &feed)
	}()

	jsonResponse(w, http.StatusOK, map[string]string{"status": "refreshing"})
}

func (h *FeedHandler) Update(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	categoryIDStr := form.Get("category_id")
	categoryID, _ := strconv.ParseInt(categoryIDStr, 10, 64)

	var customName *string
	if name := form.Get("name"); name != "" {
		customName = &name
	}

	var filterRules json.RawMessage
	if fr := form.Get("filter_rules"); fr != "" {
		filterRules = json.RawMessage(fr)
		// Validate filter patterns
		var rules service.FilterRules
		if jsonErr := json.Unmarshal(filterRules, &rules); jsonErr == nil {
			for _, pattern := range rules.ExcludeTitle {
				if pattern != "" && !service.ValidateFilterPattern(pattern) {
					validationError(w, r, h.inertia, map[string]string{"filter_rules": "Invalid or unsafe filter pattern in title filter."})
					return
				}
			}
			for _, pattern := range rules.ExcludeContent {
				if pattern != "" && !service.ValidateFilterPattern(pattern) {
					validationError(w, r, h.inertia, map[string]string{"filter_rules": "Invalid or unsafe filter pattern in content filter."})
					return
				}
			}
			for _, pattern := range rules.ExcludeAuthor {
				if pattern != "" && !service.ValidateFilterPattern(pattern) {
					validationError(w, r, h.inertia, map[string]string{"filter_rules": "Invalid or unsafe filter pattern in author filter."})
					return
				}
			}
		}
	}

	err = h.q.UpdateSubscription(r.Context(), db.UpdateSubscriptionParams{
		UserID: user.ID, FeedID: feedID, CategoryID: categoryID,
		CustomFeedName: customName, FilterRules: filterRules,
	})
	if err != nil {
		http.Error(w, "Could not update feed", http.StatusInternalServerError)
		return
	}

	// Re-apply filters if rules changed
	if filterRules != nil {
		sub, err := h.q.GetSubscription(r.Context(), db.GetSubscriptionParams{UserID: user.ID, FeedID: feedID})
		if err == nil {
			allEntries, _ := h.q.EntriesForFeed(r.Context(), feedID)
			h.filter.ApplyFilters(r.Context(), sub, allEntries)
		}
	}

	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

func (h *FeedHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	_ = db.MarkAllAsRead(r.Context(), h.q, user.ID, feedID)
	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

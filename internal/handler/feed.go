package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	gonertia "github.com/romsar/gonertia/v2"
)

type createFeedRequest struct {
	FeedURL      string `json:"feed_url" validate:"required" label:"feed URL"`
	CategoryID   *int64 `json:"category_id"`
	CategoryName string `json:"category_name"`
}

type updateFeedRequest struct {
	CategoryID  int64                `json:"category_id"`
	Name        string               `json:"name"`
	FilterRules *service.FilterRules `json:"filter_rules"`
}

type FeedHandler struct {
	inertia     *gonertia.Inertia
	pool        *db.Pool
	q           *db.Queries
	feedService *service.FeedService
	faviconSvc  *service.FaviconService
	filter      *service.FilterService
}

func NewFeedHandler(i *gonertia.Inertia, pool *db.Pool, q *db.Queries, feedSvc *service.FeedService, faviconSvc *service.FaviconService, filter *service.FilterService) *FeedHandler {
	return &FeedHandler{
		inertia: i, pool: pool, q: q,
		feedService: feedSvc, faviconSvc: faviconSvc, filter: filter,
	}
}

func (h *FeedHandler) Create(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest[createFeedRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	if errs := validateRequest(req); errs != nil {
		validationError(w, r, h.inertia, errs)
		return
	}

	user := auth.UserFromRequest(r)

	// Determine category
	v := newValidationErrs()
	var categoryID int64
	if req.CategoryID != nil {
		categoryID = *req.CategoryID
	} else if req.CategoryName != "" {
		cat, err := h.q.FindOrCreateCategory(r.Context(), db.FindOrCreateCategoryParams{UserID: user.ID, Name: req.CategoryName})
		if err != nil {
			v.Add("category_name", "Could not create category.")
		} else {
			categoryID = cat.ID
		}
	}

	if categoryID == 0 && !v.HasErrors() {
		v.Add("category_id", "A category is required.")
	}

	if v.HasErrors() {
		validationError(w, r, h.inertia, v.Map())
		return
	}

	feed, err := h.feedService.CreateFeed(r.Context(), user.ID, req.FeedURL, categoryID, "")
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
	req, err := decodeRequest[updateFeedRequest](r)
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

	var customName *string
	if req.Name != "" {
		customName = &req.Name
	}

	var filterRulesJSON json.RawMessage
	if req.FilterRules != nil {
		// Validate filter patterns
		for _, pattern := range req.FilterRules.ExcludeTitle {
			if pattern != "" && !service.ValidateFilterPattern(pattern) {
				validationError(w, r, h.inertia, map[string]string{"filter_rules": "Invalid or unsafe filter pattern in title filter."})
				return
			}
		}
		for _, pattern := range req.FilterRules.ExcludeContent {
			if pattern != "" && !service.ValidateFilterPattern(pattern) {
				validationError(w, r, h.inertia, map[string]string{"filter_rules": "Invalid or unsafe filter pattern in content filter."})
				return
			}
		}
		for _, pattern := range req.FilterRules.ExcludeAuthor {
			if pattern != "" && !service.ValidateFilterPattern(pattern) {
				validationError(w, r, h.inertia, map[string]string{"filter_rules": "Invalid or unsafe filter pattern in author filter."})
				return
			}
		}
		filterRulesJSON, _ = json.Marshal(req.FilterRules)
	}

	err = h.q.UpdateSubscription(r.Context(), db.UpdateSubscriptionParams{
		UserID: user.ID, FeedID: feedID, CategoryID: req.CategoryID,
		CustomFeedName: customName, FilterRules: filterRulesJSON,
	})
	if err != nil {
		http.Error(w, "Could not update feed", http.StatusInternalServerError)
		return
	}

	// Re-apply filters if rules changed
	if req.FilterRules != nil {
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

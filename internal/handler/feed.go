package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	gonertia "github.com/romsar/gonertia/v2"
)

type createFeedRequest struct {
	FeedURL      string `json:"feed_url" validate:"required,max=255" label:"feed URL"`
	CategoryID   *int64 `json:"category_id"`
	CategoryName string `json:"category_name"`
}

type updateFeedRequest struct {
	CategoryID  int64                `json:"category_id"`
	Name        string               `json:"name" validate:"max=255"`
	FilterRules *service.FilterRules `json:"filter_rules"`
}

// RefreshFaviconArgs must match worker.RefreshFaviconArgs for River dispatch.
type RefreshFaviconArgs struct {
	FeedID int64 `json:"feed_id"`
}

func (RefreshFaviconArgs) Kind() string { return "refresh_favicon" }

type FeedHandler struct {
	inertia     *gonertia.Inertia
	feedService feedService
	riverClient *river.Client[pgx.Tx]
}

func NewFeedHandler(i *gonertia.Inertia, feedSvc feedService, rc *river.Client[pgx.Tx]) *FeedHandler {
	return &FeedHandler{
		inertia: i, feedService: feedSvc, riverClient: rc,
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

	categoryID, err := h.feedService.ResolveCategory(r.Context(), user.ID, req.CategoryID, req.CategoryName)
	if err != nil {
		field := "category_id"
		if req.CategoryName != "" {
			field = "category_name"
		}
		validationError(w, r, h.inertia, map[string]string{field: err.Error()})
		return
	}

	feed, err := h.feedService.CreateFeed(r.Context(), user.ID, req.FeedURL, categoryID, "")
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"feed_url": err.Error()})
		return
	}

	// Enqueue favicon refresh as a River job
	_, err = h.riverClient.Insert(context.Background(), RefreshFaviconArgs{FeedID: feed.ID}, &river.InsertOpts{
		UniqueOpts: river.UniqueOpts{
			ByArgs:   true,
			ByPeriod: 1 * time.Hour,
		},
	})
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to enqueue favicon refresh", "feed_id", feed.ID, "error", err)
	}

	http.Redirect(w, r, "/feeds?feed="+strconv.FormatInt(feed.ID, 10), http.StatusFound)
}

func (h *FeedHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	err = h.feedService.Unsubscribe(r.Context(), user.ID, feedID)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *FeedHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	subscribed, err := h.feedService.IsUserSubscribed(r.Context(), user.ID, feedID)
	if err != nil {
		handleServiceErrorJSON(w, err)
		return
	}
	if !subscribed {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	feed, err := h.feedService.FindFeedByID(r.Context(), feedID)
	if err != nil {
		handleServiceErrorJSON(w, err)
		return
	}

	// Rate limit: 5 minutes between refreshes
	if feed.LastSuccessfulRefreshAt != nil && time.Since(*feed.LastSuccessfulRefreshAt) < 5*time.Minute {
		jsonResponse(w, http.StatusTooManyRequests, map[string]string{"message": "Feed has already been refreshed less than 5min ago"})
		return
	}

	newCount, err := h.feedService.RefreshFeed(r.Context(), feed)
	if err != nil {
		jsonResponse(w, http.StatusOK, map[string]any{"success": false, "error": err.Error()})
		return
	}

	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "new_entries": newCount})
}

func (h *FeedHandler) RefreshFavicon(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	subscribed, err := h.feedService.IsUserSubscribed(r.Context(), user.ID, feedID)
	if err != nil {
		handleServiceErrorJSON(w, err)
		return
	}
	if !subscribed {
		jsonResponse(w, http.StatusForbidden, map[string]string{"error": "forbidden"})
		return
	}

	feed, err := h.feedService.FindFeedByID(r.Context(), feedID)
	if err != nil {
		handleServiceErrorJSON(w, err)
		return
	}

	// Enqueue favicon refresh as a River job
	_, err = h.riverClient.Insert(context.Background(), RefreshFaviconArgs{FeedID: feed.ID}, &river.InsertOpts{
		UniqueOpts: river.UniqueOpts{
			ByArgs:   true,
			ByPeriod: 1 * time.Hour,
		},
	})
	if err != nil {
		jsonResponse(w, http.StatusInternalServerError, map[string]string{"error": "failed to enqueue favicon refresh"})
		return
	}

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

	// Validate filter patterns (field-level validation for error messages)
	if req.FilterRules != nil {
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
	}

	var filterRulesJSON json.RawMessage
	if req.FilterRules != nil {
		var marshalErr error
		filterRulesJSON, marshalErr = json.Marshal(req.FilterRules)
		if marshalErr != nil {
			slog.ErrorContext(r.Context(), "failed to marshal filter rules", "error", marshalErr)
			renderError(w, r, h.inertia, http.StatusInternalServerError)
			return
		}
	}

	err = h.feedService.UpdateSubscription(r.Context(), user.ID, feedID, req.CategoryID, customName, filterRulesJSON)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
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

	err = h.feedService.MarkAllAsRead(r.Context(), user.ID, feedID)
	if err != nil {
		slog.ErrorContext(r.Context(), "failed to mark all as read", "user_id", user.ID, "feed_id", feedID, "error", err)
	}
	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	err := json.NewEncoder(w).Encode(data)
	if err != nil {
		slog.Error("failed to write JSON response", "error", err)
	}
}

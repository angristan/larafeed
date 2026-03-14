package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/go-chi/chi/v5"
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
	feedService feedService
	faviconSvc  faviconService
}

func NewFeedHandler(i *gonertia.Inertia, feedSvc feedService, faviconSvc faviconService) *FeedHandler {
	return &FeedHandler{
		inertia: i, feedService: feedSvc, faviconSvc: faviconSvc,
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

	if err := h.feedService.Unsubscribe(r.Context(), user.ID, feedID); err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
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

	feed, err := h.feedService.FindFeedByID(r.Context(), feedID)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Feed not found"})
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
	feedID, err := strconv.ParseInt(chi.URLParam(r, "feed_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid feed ID", http.StatusBadRequest)
		return
	}

	feed, err := h.feedService.FindFeedByID(r.Context(), feedID)
	if err != nil {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": "Feed not found"})
		return
	}

	go func() {
		_ = h.faviconSvc.RefreshFavicon(r.Context(), feed)
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
		filterRulesJSON, _ = json.Marshal(req.FilterRules)
	}

	if err := h.feedService.UpdateSubscription(r.Context(), user.ID, feedID, req.CategoryID, customName, filterRulesJSON); err != nil {
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

	_ = h.feedService.MarkAllAsRead(r.Context(), user.ID, feedID)
	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

func jsonResponse(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

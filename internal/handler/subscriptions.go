package handler

import (
	"net/http"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	gonertia "github.com/romsar/gonertia/v2"
)

type SubscriptionsHandler struct {
	inertia    *gonertia.Inertia
	q          *db.Queries
	faviconSvc *service.FaviconService
}

func NewSubscriptionsHandler(i *gonertia.Inertia, q *db.Queries, faviconSvc *service.FaviconService) *SubscriptionsHandler {
	return &SubscriptionsHandler{inertia: i, q: q, faviconSvc: faviconSvc}
}

// subscriptionFeedDTO matches the frontend SubscriptionFeedDto shape.
type subscriptionFeedDTO struct {
	ID                      int64                    `json:"id"`
	Name                    string                   `json:"name"`
	OriginalName            string                   `json:"original_name"`
	FeedURL                 string                   `json:"feed_url"`
	SiteURL                 string                   `json:"site_url"`
	FaviconURL              string                   `json:"favicon_url"`
	FaviconIsDark           *bool                    `json:"favicon_is_dark"`
	EntriesCount            int64                    `json:"entries_count"`
	LastSuccessfulRefreshAt *string                  `json:"last_successful_refresh_at"`
	LastFailedRefreshAt     *string                  `json:"last_failed_refresh_at"`
	LastErrorMessage        *string                  `json:"last_error_message"`
	Category                *subscriptionCategoryDTO `json:"category"`
	Refreshes               []refreshDTO             `json:"refreshes"`
}

type subscriptionCategoryDTO struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type refreshDTO struct {
	ID             int64   `json:"id"`
	RefreshedAt    *string `json:"refreshed_at"`
	WasSuccessful  bool    `json:"was_successful"`
	EntriesCreated *int    `json:"entries_created"`
	ErrorMessage   *string `json:"error_message"`
}

func (h *SubscriptionsHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	feeds, err := h.q.ListSubscriptionsForUser(r.Context(), user.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	cats, _ := h.q.ListCategoriesForUser(r.Context(), user.ID)

	// Transform to frontend-expected shape
	dtos := make([]subscriptionFeedDTO, len(feeds))
	for i, f := range feeds {
		displayName := f.Name
		if f.CustomFeedName != nil && *f.CustomFeedName != "" {
			displayName = *f.CustomFeedName
		}

		// Fetch recent refreshes for this feed
		refreshRows, _ := h.q.ListFeedRefreshes(r.Context(), f.ID)
		refreshes := make([]refreshDTO, len(refreshRows))
		for j, rr := range refreshRows {
			var refreshedAt *string
			if !rr.RefreshedAt.IsZero() {
				s := rr.RefreshedAt.Format(time.RFC3339)
				refreshedAt = &s
			}
			refreshes[j] = refreshDTO{
				ID:             rr.ID,
				RefreshedAt:    refreshedAt,
				WasSuccessful:  rr.WasSuccessful,
				EntriesCreated: rr.EntriesCreated,
				ErrorMessage:   rr.ErrorMessage,
			}
		}

		var lastSuccess, lastFailure *string
		if f.LastSuccessfulRefreshAt != nil {
			s := f.LastSuccessfulRefreshAt.Format(time.RFC3339)
			lastSuccess = &s
		}
		if f.LastFailedRefreshAt != nil {
			s := f.LastFailedRefreshAt.Format(time.RFC3339)
			lastFailure = &s
		}

		dtos[i] = subscriptionFeedDTO{
			ID:                      f.ID,
			Name:                    displayName,
			OriginalName:            f.Name,
			FeedURL:                 f.FeedURL,
			SiteURL:                 f.SiteURL,
			FaviconURL:              h.faviconSvc.BuildProxifiedFaviconURL(f.FaviconURL),
			FaviconIsDark:           f.FaviconIsDark,
			EntriesCount:            f.EntryCount,
			LastSuccessfulRefreshAt: lastSuccess,
			LastFailedRefreshAt:     lastFailure,
			LastErrorMessage:        f.LastErrorMessage,
			Category:                &subscriptionCategoryDTO{ID: f.CategoryID, Name: f.CategoryName},
			Refreshes:               refreshes,
		}
	}

	render(w, r, h.inertia, "Subscriptions", gonertia.Props{
		"feeds":      dtos,
		"categories": cats,
	})
}

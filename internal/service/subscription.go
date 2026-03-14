package service

import (
	"context"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
)

type SubscriptionService struct {
	q          db.Querier
	faviconSvc *FaviconService
}

func NewSubscriptionService(q db.Querier, faviconSvc *FaviconService) *SubscriptionService {
	return &SubscriptionService{q: q, faviconSvc: faviconSvc}
}

// SubscriptionFeed is the DTO for the subscriptions management page.
type SubscriptionFeed struct {
	ID                      int64                `json:"id"`
	Name                    string               `json:"name"`
	OriginalName            string               `json:"original_name"`
	FeedURL                 string               `json:"feed_url"`
	SiteURL                 string               `json:"site_url"`
	FaviconURL              string               `json:"favicon_url"`
	FaviconIsDark           *bool                `json:"favicon_is_dark"`
	EntriesCount            int64                `json:"entries_count"`
	LastSuccessfulRefreshAt *string              `json:"last_successful_refresh_at"`
	LastFailedRefreshAt     *string              `json:"last_failed_refresh_at"`
	LastErrorMessage        *string              `json:"last_error_message"`
	Category                *SubscriptionCatDTO  `json:"category"`
	Refreshes               []SubscriptionRefDTO `json:"refreshes"`
}

type SubscriptionCatDTO struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

type SubscriptionRefDTO struct {
	ID             int64   `json:"id"`
	RefreshedAt    *string `json:"refreshed_at"`
	WasSuccessful  bool    `json:"was_successful"`
	EntriesCreated *int    `json:"entries_created"`
	ErrorMessage   *string `json:"error_message"`
}

// ListSubscriptions returns all subscriptions for the user with refresh history.
func (s *SubscriptionService) ListSubscriptions(ctx context.Context, userID int64) ([]SubscriptionFeed, error) {
	feeds, err := s.q.ListSubscriptionsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	dtos := make([]SubscriptionFeed, len(feeds))
	for i, f := range feeds {
		displayName := f.Name
		if f.CustomFeedName != nil && *f.CustomFeedName != "" {
			displayName = *f.CustomFeedName
		}

		refreshRows, _ := s.q.ListFeedRefreshes(ctx, f.ID)
		refreshes := make([]SubscriptionRefDTO, len(refreshRows))
		for j, rr := range refreshRows {
			var refreshedAt *string
			if !rr.RefreshedAt.IsZero() {
				t := rr.RefreshedAt.Format(time.RFC3339)
				refreshedAt = &t
			}
			refreshes[j] = SubscriptionRefDTO{
				ID:             rr.ID,
				RefreshedAt:    refreshedAt,
				WasSuccessful:  rr.WasSuccessful,
				EntriesCreated: rr.EntriesCreated,
				ErrorMessage:   rr.ErrorMessage,
			}
		}

		var lastSuccess, lastFailure *string
		if f.LastSuccessfulRefreshAt != nil {
			t := f.LastSuccessfulRefreshAt.Format(time.RFC3339)
			lastSuccess = &t
		}
		if f.LastFailedRefreshAt != nil {
			t := f.LastFailedRefreshAt.Format(time.RFC3339)
			lastFailure = &t
		}

		dtos[i] = SubscriptionFeed{
			ID:                      f.ID,
			Name:                    displayName,
			OriginalName:            f.Name,
			FeedURL:                 f.FeedURL,
			SiteURL:                 f.SiteURL,
			FaviconURL:              s.faviconSvc.BuildProxifiedFaviconURL(f.FaviconURL),
			FaviconIsDark:           f.FaviconIsDark,
			EntriesCount:            f.EntryCount,
			LastSuccessfulRefreshAt: lastSuccess,
			LastFailedRefreshAt:     lastFailure,
			LastErrorMessage:        f.LastErrorMessage,
			Category:                &SubscriptionCatDTO{ID: f.CategoryID, Name: f.CategoryName},
			Refreshes:               refreshes,
		}
	}
	return dtos, nil
}

// ListCategories returns all subscription categories for the user.
func (s *SubscriptionService) ListCategories(ctx context.Context, userID int64) ([]db.SubscriptionCategory, error) {
	return s.q.ListCategoriesForUser(ctx, userID)
}

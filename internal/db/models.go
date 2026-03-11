package db

import (
	"encoding/json"
	"time"
)

type User struct {
	ID                     int64      `json:"id"`
	Name                   string     `json:"name"`
	Email                  string     `json:"email"`
	EmailVerifiedAt        *time.Time `json:"email_verified_at"`
	Password               string     `json:"-"`
	RememberToken          *string    `json:"-"`
	FeverAPIKey            *string    `json:"-"`
	TwoFactorSecret        *string    `json:"-"`
	TwoFactorRecoveryCodes *string    `json:"-"`
	TwoFactorConfirmedAt   *time.Time `json:"-"`
	CreatedAt              *time.Time `json:"created_at"`
	UpdatedAt              *time.Time `json:"updated_at"`
}

type Feed struct {
	ID                      int64      `json:"id"`
	Name                    string     `json:"name"`
	FeedURL                 string     `json:"feed_url"`
	SiteURL                 string     `json:"site_url"`
	FaviconURL              *string    `json:"favicon_url"`
	FaviconIsDark           *bool      `json:"favicon_is_dark"`
	FaviconUpdatedAt        *time.Time `json:"favicon_updated_at"`
	LastSuccessfulRefreshAt *time.Time `json:"last_successful_refresh_at"`
	LastFailedRefreshAt     *time.Time `json:"last_failed_refresh_at"`
	LastErrorMessage        *string    `json:"last_error_message"`
	CreatedAt               *time.Time `json:"created_at"`
	UpdatedAt               *time.Time `json:"updated_at"`
}

type Entry struct {
	ID          int64      `json:"id"`
	FeedID      int64      `json:"feed_id"`
	Title       string     `json:"title"`
	URL         string     `json:"url"`
	Author      *string    `json:"author"`
	Content     *string    `json:"content"`
	PublishedAt time.Time  `json:"published_at"`
	CreatedAt   *time.Time `json:"created_at"`
	UpdatedAt   *time.Time `json:"updated_at"`
}

type FeedSubscription struct {
	UserID         int64           `json:"user_id"`
	FeedID         int64           `json:"feed_id"`
	CategoryID     int64           `json:"category_id"`
	CustomFeedName *string         `json:"custom_feed_name"`
	FilterRules    json.RawMessage `json:"filter_rules"`
	CreatedAt      *time.Time      `json:"created_at"`
	UpdatedAt      *time.Time      `json:"updated_at"`
}

type EntryInteraction struct {
	UserID     int64      `json:"user_id"`
	EntryID    int64      `json:"entry_id"`
	ReadAt     *time.Time `json:"read_at"`
	StarredAt  *time.Time `json:"starred_at"`
	ArchivedAt *time.Time `json:"archived_at"`
	FilteredAt *time.Time `json:"filtered_at"`
	CreatedAt  *time.Time `json:"created_at"`
	UpdatedAt  *time.Time `json:"updated_at"`
}

type SubscriptionCategory struct {
	ID        int64      `json:"id"`
	UserID    int64      `json:"user_id"`
	Name      string     `json:"name"`
	CreatedAt *time.Time `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at"`
}

type FeedRefresh struct {
	ID             int64      `json:"id"`
	FeedID         int64      `json:"feed_id"`
	RefreshedAt    time.Time  `json:"refreshed_at"`
	WasSuccessful  bool       `json:"was_successful"`
	EntriesCreated *int       `json:"entries_created"`
	ErrorMessage   *string    `json:"error_message"`
	CreatedAt      *time.Time `json:"created_at"`
	UpdatedAt      *time.Time `json:"updated_at"`
}

type PersonalAccessToken struct {
	ID            int64      `json:"id"`
	TokenableType string     `json:"tokenable_type"`
	TokenableID   int64      `json:"tokenable_id"`
	Name          string     `json:"name"`
	Token         string     `json:"-"`
	Abilities     *string    `json:"abilities"`
	LastUsedAt    *time.Time `json:"last_used_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
	CreatedAt     *time.Time `json:"created_at"`
	UpdatedAt     *time.Time `json:"updated_at"`
}

type PasswordResetToken struct {
	Email     string     `json:"email"`
	Token     string     `json:"-"`
	CreatedAt *time.Time `json:"created_at"`
}

type Cache struct {
	Key        string `json:"key"`
	Value      string `json:"value"`
	Expiration int    `json:"expiration"`
}

package service

import (
	"context"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/mock"
)

// mockQuerier implements db.Querier for testing. Only stub the methods used by tests.
type mockQuerier struct {
	mock.Mock
}

func (m *mockQuerier) FindOrCreateCategory(ctx context.Context, arg db.FindOrCreateCategoryParams) (db.SubscriptionCategory, error) {
	args := m.Called(ctx, arg)
	return args.Get(0).(db.SubscriptionCategory), args.Error(1)
}

func (m *mockQuerier) FindFeedByID(ctx context.Context, id int64) (db.Feed, error) {
	args := m.Called(ctx, id)
	return args.Get(0).(db.Feed), args.Error(1)
}

func (m *mockQuerier) UpdateSubscription(ctx context.Context, arg db.UpdateSubscriptionParams) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (m *mockQuerier) GetSubscription(ctx context.Context, arg db.GetSubscriptionParams) (db.FeedSubscription, error) {
	args := m.Called(ctx, arg)
	return args.Get(0).(db.FeedSubscription), args.Error(1)
}

func (m *mockQuerier) EntriesForFeed(ctx context.Context, feedID int64) ([]db.Entry, error) {
	args := m.Called(ctx, feedID)
	return args.Get(0).([]db.Entry), args.Error(1)
}

func (m *mockQuerier) MarkAllAsReadExisting(ctx context.Context, arg db.MarkAllAsReadExistingParams) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (m *mockQuerier) MarkAllAsReadNew(ctx context.Context, arg db.MarkAllAsReadNewParams) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (m *mockQuerier) ListSubscriptionsForUser(ctx context.Context, userID int64) ([]db.ListSubscriptionsForUserRow, error) {
	args := m.Called(ctx, userID)
	return args.Get(0).([]db.ListSubscriptionsForUserRow), args.Error(1)
}

func (m *mockQuerier) CountForReader(ctx context.Context, arg db.CountForReaderParams) (int64, error) {
	args := m.Called(ctx, arg)
	return args.Get(0).(int64), args.Error(1)
}

func (m *mockQuerier) ListForReaderByPublished(ctx context.Context, arg db.ListForReaderByPublishedParams) ([]db.ListForReaderByPublishedRow, error) {
	args := m.Called(ctx, arg)
	return args.Get(0).([]db.ListForReaderByPublishedRow), args.Error(1)
}

func (m *mockQuerier) ListForReaderByCreated(ctx context.Context, arg db.ListForReaderByCreatedParams) ([]db.ListForReaderByCreatedRow, error) {
	args := m.Called(ctx, arg)
	return args.Get(0).([]db.ListForReaderByCreatedRow), args.Error(1)
}

func (m *mockQuerier) CountUnread(ctx context.Context, userID int64) (int64, error) {
	args := m.Called(ctx, userID)
	return args.Get(0).(int64), args.Error(1)
}

func (m *mockQuerier) CountRead(ctx context.Context, userID int64) (int64, error) {
	args := m.Called(ctx, userID)
	return args.Get(0).(int64), args.Error(1)
}

func (m *mockQuerier) ListCategoriesForUser(ctx context.Context, userID int64) ([]db.SubscriptionCategory, error) {
	args := m.Called(ctx, userID)
	return args.Get(0).([]db.SubscriptionCategory), args.Error(1)
}

func (m *mockQuerier) FindReaderEntry(ctx context.Context, arg db.FindReaderEntryParams) (db.FindReaderEntryRow, error) {
	args := m.Called(ctx, arg)
	return args.Get(0).(db.FindReaderEntryRow), args.Error(1)
}

func (m *mockQuerier) MarkAsRead(ctx context.Context, arg db.MarkAsReadParams) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (m *mockQuerier) MarkAsUnread(ctx context.Context, arg db.MarkAsUnreadParams) error {
	args := m.Called(ctx, arg)
	return args.Error(0)
}

func (m *mockQuerier) FindEntryByID(ctx context.Context, id int64) (db.Entry, error) {
	args := m.Called(ctx, id)
	return args.Get(0).(db.Entry), args.Error(1)
}

// Remaining Querier methods — stubbed to satisfy the interface.
func (m *mockQuerier) Archive(ctx context.Context, arg db.ArchiveParams) error { return nil }
func (m *mockQuerier) CacheGet(ctx context.Context, key string) (db.CacheGetRow, error) {
	return db.CacheGetRow{}, nil
}
func (m *mockQuerier) CacheSet(ctx context.Context, arg db.CacheSetParams) error { return nil }
func (m *mockQuerier) CategoryHasSubscriptions(ctx context.Context, categoryID int64) (int64, error) {
	return 0, nil
}
func (m *mockQuerier) ClearFiltered(ctx context.Context, arg db.ClearFilteredParams) error {
	return nil
}
func (m *mockQuerier) ClearUserEmailVerification(ctx context.Context, id int64) error { return nil }
func (m *mockQuerier) CountFeedSubscribers(ctx context.Context, feedID int64) (int64, error) {
	return 0, nil
}
func (m *mockQuerier) CreateCategory(ctx context.Context, arg db.CreateCategoryParams) (db.SubscriptionCategory, error) {
	return db.SubscriptionCategory{}, nil
}
func (m *mockQuerier) CreateFeed(ctx context.Context, arg db.CreateFeedParams) (db.Feed, error) {
	return db.Feed{}, nil
}
func (m *mockQuerier) CreatePasswordReset(ctx context.Context, arg db.CreatePasswordResetParams) error {
	return nil
}
func (m *mockQuerier) CreatePersonalAccessToken(ctx context.Context, arg db.CreatePersonalAccessTokenParams) error {
	return nil
}
func (m *mockQuerier) CreateUser(ctx context.Context, arg db.CreateUserParams) (db.User, error) {
	return db.User{}, nil
}
func (m *mockQuerier) DeleteAllCategoriesForUser(ctx context.Context, userID int64) error {
	return nil
}
func (m *mockQuerier) DeleteAllInteractionsForUser(ctx context.Context, userID int64) error {
	return nil
}
func (m *mockQuerier) DeleteAllSubscriptionsForUser(ctx context.Context, userID int64) error {
	return nil
}
func (m *mockQuerier) DeleteCategory(ctx context.Context, id int64) error    { return nil }
func (m *mockQuerier) DeleteFeed(ctx context.Context, id int64) error        { return nil }
func (m *mockQuerier) DeletePasswordReset(ctx context.Context, email string) error { return nil }
func (m *mockQuerier) DeleteUser(ctx context.Context, id int64) error        { return nil }
func (m *mockQuerier) DeleteUserTokens(ctx context.Context, arg db.DeleteUserTokensParams) error {
	return nil
}
func (m *mockQuerier) DeleteInteractionsForFeed(ctx context.Context, arg db.DeleteInteractionsForFeedParams) error {
	return nil
}
func (m *mockQuerier) Favorite(ctx context.Context, arg db.FavoriteParams) error { return nil }
func (m *mockQuerier) FeedsMissingFavicons(ctx context.Context) ([]db.Feed, error) {
	return nil, nil
}
func (m *mockQuerier) FeedsNeedingRefresh(ctx context.Context, arg db.FeedsNeedingRefreshParams) ([]db.Feed, error) {
	return nil, nil
}
func (m *mockQuerier) FeedsWithOutdatedFavicons(ctx context.Context, olderThan pgtype.Interval) ([]db.Feed, error) {
	return nil, nil
}
func (m *mockQuerier) FindCategoryByID(ctx context.Context, id int64) (db.SubscriptionCategory, error) {
	return db.SubscriptionCategory{}, nil
}
func (m *mockQuerier) FindFeedByURL(ctx context.Context, feedUrl string) (db.Feed, error) {
	return db.Feed{}, nil
}
func (m *mockQuerier) FindPasswordReset(ctx context.Context, email string) (db.PasswordResetToken, error) {
	return db.PasswordResetToken{}, nil
}
func (m *mockQuerier) FindPersonalAccessToken(ctx context.Context, token string) (db.PersonalAccessToken, error) {
	return db.PersonalAccessToken{}, nil
}
func (m *mockQuerier) FindUserByEmail(ctx context.Context, email string) (db.User, error) {
	return db.User{}, nil
}
func (m *mockQuerier) FindUserByFeverApiKey(ctx context.Context, feverApiKey *string) (db.User, error) {
	return db.User{}, nil
}
func (m *mockQuerier) FindUserByID(ctx context.Context, id int64) (db.User, error) {
	return db.User{}, nil
}
func (m *mockQuerier) GetRefreshStats(ctx context.Context, arg db.GetRefreshStatsParams) (db.GetRefreshStatsRow, error) {
	return db.GetRefreshStatsRow{}, nil
}
func (m *mockQuerier) ListFeedIDsForUser(ctx context.Context, userID int64) ([]int64, error) {
	return nil, nil
}
func (m *mockQuerier) ListFeedRefreshes(ctx context.Context, feedID int64) ([]db.FeedRefresh, error) {
	return nil, nil
}
func (m *mockQuerier) MarkFiltered(ctx context.Context, arg db.MarkFilteredParams) error {
	return nil
}
func (m *mockQuerier) RecordRefresh(ctx context.Context, arg db.RecordRefreshParams) error {
	return nil
}
func (m *mockQuerier) StarredIDs(ctx context.Context, userID int64) ([]int64, error) {
	return nil, nil
}
func (m *mockQuerier) Subscribe(ctx context.Context, arg db.SubscribeParams) error { return nil }
func (m *mockQuerier) SubscriptionsWithFilters(ctx context.Context, feedID int64) ([]db.FeedSubscription, error) {
	return nil, nil
}
func (m *mockQuerier) TouchTokenLastUsed(ctx context.Context, id int64) error { return nil }
func (m *mockQuerier) Unarchive(ctx context.Context, arg db.UnarchiveParams) error { return nil }
func (m *mockQuerier) Unfavorite(ctx context.Context, arg db.UnfavoriteParams) error { return nil }
func (m *mockQuerier) UnreadIDs(ctx context.Context, userID int64) ([]int64, error) {
	return nil, nil
}
func (m *mockQuerier) Unsubscribe(ctx context.Context, arg db.UnsubscribeParams) error { return nil }
func (m *mockQuerier) UpdateFeedFavicon(ctx context.Context, arg db.UpdateFeedFaviconParams) error {
	return nil
}
func (m *mockQuerier) UpdateFeedRefreshFailure(ctx context.Context, arg db.UpdateFeedRefreshFailureParams) error {
	return nil
}
func (m *mockQuerier) UpdateFeedRefreshSuccess(ctx context.Context, id int64) error { return nil }
func (m *mockQuerier) UpdateUserPassword(ctx context.Context, arg db.UpdateUserPasswordParams) error {
	return nil
}
func (m *mockQuerier) UpdateUserPasswordAndFeverKey(ctx context.Context, arg db.UpdateUserPasswordAndFeverKeyParams) error {
	return nil
}
func (m *mockQuerier) UpdateUserProfile(ctx context.Context, arg db.UpdateUserProfileParams) error {
	return nil
}
func (m *mockQuerier) UpdateUserTwoFactor(ctx context.Context, arg db.UpdateUserTwoFactorParams) error {
	return nil
}
func (m *mockQuerier) VerifyUserEmail(ctx context.Context, id int64) error { return nil }

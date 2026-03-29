package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/angristan/larafeed-go/internal/apperr"
	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserService struct {
	q    db.Querier
	pool *pgxpool.Pool
}

func NewUserService(q db.Querier, pool *pgxpool.Pool) *UserService {
	return &UserService{q: q, pool: pool}
}

// UpdateProfile updates a user's name and email. If the email changes,
// the email verification is cleared. Returns an error if the new email is taken.
func (s *UserService) UpdateProfile(ctx context.Context, userID int64, currentEmail, name, email string) error {
	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	if name == "" {
		return apperr.NewValidation("name", "A name is required.")
	}
	if email == "" {
		return apperr.NewValidation("email", "An email is required.")
	}

	if email != currentEmail {
		if _, err := s.q.FindUserByEmail(ctx, email); err == nil {
			return apperr.NewValidation("email", "The email has already been taken.")
		}
	}

	if err := s.q.UpdateUserProfile(ctx, db.UpdateUserProfileParams{ID: userID, Name: name, Email: email}); err != nil {
		return err
	}

	if email != currentEmail {
		if err := s.q.ClearUserEmailVerification(ctx, userID); err != nil {
			return err
		}
	}

	return nil
}

// DeleteAccount deletes a user account.
func (s *UserService) DeleteAccount(ctx context.Context, userID int64) error {
	return s.q.DeleteUser(ctx, userID)
}

// WipeAccount removes all user data (interactions, subscriptions, orphaned feeds,
// categories) while keeping the account itself.
func (s *UserService) WipeAccount(ctx context.Context, userID int64) error {
	return db.WithTx(ctx, s.pool, func(ctx context.Context, tx pgx.Tx) error {
		qtx := db.New(tx)

		if err := qtx.DeleteAllInteractionsForUser(ctx, userID); err != nil {
			return err
		}

		feedIDs, err := qtx.ListFeedIDsForUser(ctx, userID)
		if err != nil {
			return err
		}

		if err := qtx.DeleteAllSubscriptionsForUser(ctx, userID); err != nil {
			return err
		}

		for _, feedID := range feedIDs {
			count, err := qtx.CountFeedSubscribers(ctx, feedID)
			if err != nil {
				return err
			}
			if count == 0 {
				if err := qtx.DeleteFeed(ctx, feedID); err != nil {
					return err
				}
			}
		}

		return qtx.DeleteAllCategoriesForUser(ctx, userID)
	})
}

// FindUserByFeverApiKey looks up a user by their Fever API key.
func (s *UserService) FindUserByFeverApiKey(ctx context.Context, apiKey *string) (*db.User, error) {
	user, err := s.q.FindUserByFeverApiKey(ctx, apiKey)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// AuthenticateReaderToken validates a Google Reader API token and returns the associated user.
func (s *UserService) AuthenticateReaderToken(ctx context.Context, tokenHash string) (*db.User, error) {
	token, err := s.q.FindPersonalAccessToken(ctx, tokenHash)
	if err != nil {
		return nil, err
	}
	if token.Abilities == nil || !strings.Contains(*token.Abilities, "reader-api") {
		return nil, fmt.Errorf("token does not have reader-api ability")
	}
	if err := s.q.TouchTokenLastUsed(ctx, token.ID); err != nil {
		slog.WarnContext(ctx, "failed to touch token last used", "error", err, "token_id", token.ID)
	}
	user, err := s.q.FindUserByID(ctx, token.TokenableID)
	if err != nil {
		return nil, err
	}
	return &user, nil
}

// CreateReaderSession authenticates a user by email/password and creates a new
// Google Reader API token, returning the plain token string.
func (s *UserService) CreateReaderSession(ctx context.Context, email, password string) (string, error) {
	if strings.TrimSpace(email) == "" || password == "" {
		return "", fmt.Errorf("invalid credentials")
	}

	user, err := s.q.FindUserByEmail(ctx, email)
	if err != nil {
		return "", fmt.Errorf("invalid credentials")
	}
	if !auth.CheckPassword(user.Password, password) {
		return "", fmt.Errorf("invalid credentials")
	}
	if err := s.q.DeleteUserTokens(ctx, db.DeleteUserTokensParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
	}); err != nil {
		slog.WarnContext(ctx, "failed to delete user tokens", "error", err, "user_id", user.ID)
	}
	plain := db.GeneratePlainToken(40)
	abilities := "[\"reader-api\"]"
	err = s.q.CreatePersonalAccessToken(ctx, db.CreatePersonalAccessTokenParams{
		TokenableType: "App\\Models\\User",
		TokenableID:   user.ID,
		Name:          "reader-auth-token",
		Token:         db.HashToken(plain),
		Abilities:     &abilities,
	})
	if err != nil {
		return "", err
	}
	return plain, nil
}

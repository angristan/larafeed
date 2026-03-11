package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5"
	gonertia "github.com/romsar/gonertia/v2"
)

type UserHandler struct {
	inertia *gonertia.Inertia
	pool    *db.Pool
	authSvc *auth.Auth
	q       *db.Queries
}

func NewUserHandler(i *gonertia.Inertia, pool *db.Pool, a *auth.Auth, q *db.Queries) *UserHandler {
	return &UserHandler{inertia: i, pool: pool, authSvc: a, q: q}
}

func (h *UserHandler) ShowSettings(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	section := r.URL.Query().Get("section")
	if section == "" {
		section = "profile"
	}

	props := gonertia.Props{
		"mustVerifyEmail":    true,
		"status":             h.authSvc.GetFlash(w, r, "status"),
		"initialSection":     section,
		"twoFactorEnabled":   user.TwoFactorSecret != nil && *user.TwoFactorSecret != "",
		"twoFactorConfirmed": user.TwoFactorConfirmedAt != nil,
	}

	if err := h.inertia.Render(w, r, "Settings/Index", props); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

func (h *UserHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	name := strings.TrimSpace(form.Get("name"))
	email := strings.ToLower(strings.TrimSpace(form.Get("email")))

	errors := map[string]string{}
	if name == "" {
		errors["name"] = "The name field is required."
	}
	if email == "" {
		errors["email"] = "The email field is required."
	}

	// Check if email changed and is taken
	if email != user.Email {
		_, err := h.q.FindUserByEmail(r.Context(), email)
		if err == nil {
			errors["email"] = "The email has already been taken."
		}
	}

	if len(errors) > 0 {
		validationError(w, r, h.inertia, errors)
		return
	}

	_ = h.q.UpdateUserProfile(r.Context(), db.UpdateUserProfileParams{ID: user.ID, Name: name, Email: email})

	// Clear verification if email changed
	if email != user.Email {
		_ = h.q.ClearUserEmailVerification(r.Context(), user.ID)
	}

	http.Redirect(w, r, "/profile", http.StatusFound)
}

func (h *UserHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	password := form.Get("password")

	if !auth.CheckPassword(user.Password, password) {
		validationError(w, r, h.inertia, map[string]string{"password": "The provided password is incorrect."})
		return
	}

	_ = h.authSvc.Logout(w, r)
	_ = h.q.DeleteUser(r.Context(), user.ID)

	http.Redirect(w, r, "/", http.StatusFound)
}

func (h *UserHandler) WipeAccount(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	err := db.WithTx(r.Context(), h.pool, func(ctx context.Context, tx pgx.Tx) error {
		// Delete all interactions
		if _, err := tx.Exec(ctx, `DELETE FROM entry_interactions WHERE user_id = $1`, user.ID); err != nil {
			return err
		}

		// Get user's feeds
		rows, err := tx.Query(ctx, `SELECT feed_id FROM feed_subscriptions WHERE user_id = $1`, user.ID)
		if err != nil {
			return err
		}
		var feedIDs []int64
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			feedIDs = append(feedIDs, id)
		}
		rows.Close()

		// Delete all subscriptions
		if _, err := tx.Exec(ctx, `DELETE FROM feed_subscriptions WHERE user_id = $1`, user.ID); err != nil {
			return err
		}

		// Delete feeds with no subscribers
		for _, feedID := range feedIDs {
			var count int
			if err := tx.QueryRow(ctx, `SELECT COUNT(*) FROM feed_subscriptions WHERE feed_id = $1`, feedID).Scan(&count); err != nil {
				return err
			}
			if count == 0 {
				if _, err := tx.Exec(ctx, `DELETE FROM feeds WHERE id = $1`, feedID); err != nil {
					return err
				}
			}
		}

		// Delete all categories
		if _, err := tx.Exec(ctx, `DELETE FROM subscription_categories WHERE user_id = $1`, user.ID); err != nil {
			return err
		}

		return nil
	})
	if err != nil {
		http.Error(w, "Failed to wipe account", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

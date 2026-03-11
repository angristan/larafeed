package auth

import (
	"context"
	"crypto/md5"
	"fmt"
	"net/http"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/gorilla/sessions"
	"golang.org/x/crypto/bcrypt"
)

type contextKey string

const (
	userContextKey contextKey = "auth_user"
	sessionName    string     = "larafeed_session"
)

type Auth struct {
	store sessions.Store
	q     *db.Queries
}

func New(sessionKey string, q *db.Queries) *Auth {
	store := sessions.NewCookieStore([]byte(sessionKey))
	store.Options = &sessions.Options{
		Path:     "/",
		MaxAge:   86400 * 30, // 30 days
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	}
	return &Auth{store: store, q: q}
}

// Store returns the session store for use by the FlashProvider.
func (a *Auth) Store() sessions.Store {
	return a.store
}

// SessionName returns the session cookie name.
func (a *Auth) SessionName() string {
	return sessionName
}

// Login stores the user ID in the session.
func (a *Auth) Login(w http.ResponseWriter, r *http.Request, userID int64) error {
	session, _ := a.store.Get(r, sessionName)
	session.Values["user_id"] = userID
	delete(session.Values, "login_id")
	delete(session.Values, "login_remember")
	return session.Save(r, w)
}

// Logout removes the user from the session.
func (a *Auth) Logout(w http.ResponseWriter, r *http.Request) error {
	session, _ := a.store.Get(r, sessionName)
	session.Options.MaxAge = -1
	return session.Save(r, w)
}

// UserFromRequest returns the authenticated user from the request context.
func UserFromRequest(r *http.Request) *db.User {
	return UserFromContext(r.Context())
}

// UserFromContext returns the authenticated user from the context.
func UserFromContext(ctx context.Context) *db.User {
	if u, ok := ctx.Value(userContextKey).(*db.User); ok {
		return u
	}
	return nil
}

// SetUserInContext adds the user to the request context.
func SetUserInContext(ctx context.Context, user *db.User) context.Context {
	return context.WithValue(ctx, userContextKey, user)
}

// GetSession returns the session.
func (a *Auth) GetSession(r *http.Request) *sessions.Session {
	session, _ := a.store.Get(r, sessionName)
	return session
}

// SetFlash sets a flash message in the session.
func (a *Auth) SetFlash(w http.ResponseWriter, r *http.Request, key, value string) {
	session, _ := a.store.Get(r, sessionName)
	session.AddFlash(value, key)
	_ = session.Save(r, w)
}

// GetFlash returns and clears a flash message.
func (a *Auth) GetFlash(w http.ResponseWriter, r *http.Request, key string) string {
	session, _ := a.store.Get(r, sessionName)
	flashes := session.Flashes(key)
	_ = session.Save(r, w)
	if len(flashes) > 0 {
		if s, ok := flashes[0].(string); ok {
			return s
		}
	}
	return ""
}

// Set2FAChallenge stores the user ID for 2FA challenge.
func (a *Auth) Set2FAChallenge(w http.ResponseWriter, r *http.Request, userID int64, remember bool) error {
	session, _ := a.store.Get(r, sessionName)
	session.Values["login_id"] = userID
	session.Values["login_remember"] = remember
	delete(session.Values, "user_id")
	return session.Save(r, w)
}

// Get2FAChallenge returns the user ID for 2FA challenge.
func (a *Auth) Get2FAChallenge(r *http.Request) (int64, bool, bool) {
	session, _ := a.store.Get(r, sessionName)
	id, ok := session.Values["login_id"].(int64)
	if !ok {
		return 0, false, false
	}
	remember, _ := session.Values["login_remember"].(bool)
	return id, remember, true
}

// HashPassword hashes a password with bcrypt.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(hash), err
}

// CheckPassword verifies a password against a bcrypt hash.
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// FeverAPIKey generates the Fever API key from email and password.
func FeverAPIKey(email, password string) string {
	return fmt.Sprintf("%x", md5.Sum([]byte(email+":"+password)))
}

// LoadUser middleware loads the authenticated user into context for all routes.
// Unlike RequireAuth, it does not redirect — it just makes the user available if logged in.
func (a *Auth) LoadUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, _ := a.store.Get(r, sessionName)
		userID, ok := session.Values["user_id"].(int64)
		if ok && a.q != nil {
			user, err := a.q.FindUserByID(r.Context(), userID)
			if err == nil {
				ctx := SetUserInContext(r.Context(), &user)
				r = r.WithContext(ctx)
			}
		}
		next.ServeHTTP(w, r)
	})
}

// RequireAuth middleware redirects to login if not authenticated.
func (a *Auth) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, _ := a.store.Get(r, sessionName)
		userID, ok := session.Values["user_id"].(int64)
		if !ok {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}

		user, err := a.q.FindUserByID(r.Context(), userID)
		if err != nil {
			http.Redirect(w, r, "/login", http.StatusFound)
			return
		}

		ctx := SetUserInContext(r.Context(), &user)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireGuest middleware redirects to feeds if authenticated.
func (a *Auth) RequireGuest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, _ := a.store.Get(r, sessionName)
		if _, ok := session.Values["user_id"].(int64); ok {
			http.Redirect(w, r, "/feeds", http.StatusFound)
			return
		}
		next.ServeHTTP(w, r)
	})
}

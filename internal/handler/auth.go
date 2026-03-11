package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/go-chi/chi/v5"
	"github.com/pquerna/otp/totp"
	gonertia "github.com/romsar/gonertia/v2"
)

type AuthHandler struct {
	inertia  *gonertia.Inertia
	auth     *auth.Auth
	q        *db.Queries
	cfg      *config.Config
	telegram *service.TelegramService
}

func NewAuthHandler(i *gonertia.Inertia, a *auth.Auth, q *db.Queries, cfg *config.Config, telegram *service.TelegramService) *AuthHandler {
	return &AuthHandler{inertia: i, auth: a, q: q, cfg: cfg, telegram: telegram}
}

func (h *AuthHandler) ShowLogin(w http.ResponseWriter, r *http.Request) {
	render(w, r, h.inertia, "Auth/Login", gonertia.Props{
		"canResetPassword": true,
		"canRegister":      h.cfg.RegistrationEnabled,
		"status":           h.auth.GetFlash(w, r, "status"),
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(form.Get("email")))
	password := form.Get("password")
	remember := form.GetBool("remember")

	user, err := h.q.FindUserByEmail(r.Context(), email)
	if err != nil || !auth.CheckPassword(user.Password, password) {
		// Notify on failure
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = strings.Split(fwd, ",")[0]
		}
		go h.telegram.NotifyLoginFailure(email, ip)

		validationError(w, r, h.inertia, map[string]string{"email": "These credentials do not match our records."})
		return
	}

	// Check for 2FA
	if user.TwoFactorSecret != nil && *user.TwoFactorSecret != "" {
		_ = h.auth.Set2FAChallenge(w, r, user.ID, remember)
		http.Redirect(w, r, "/two-factor-challenge", http.StatusFound)
		return
	}

	_ = h.auth.Login(w, r, user.ID)
	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *AuthHandler) ShowRegister(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.RegistrationEnabled {
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}
	render(w, r, h.inertia, "Auth/Register")
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.cfg.RegistrationEnabled {
		http.Error(w, "Registration is disabled", http.StatusForbidden)
		return
	}

	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	name := strings.TrimSpace(form.Get("name"))
	email := strings.ToLower(strings.TrimSpace(form.Get("email")))
	password := form.Get("password")
	passwordConfirmation := form.Get("password_confirmation")

	// Validation
	errors := map[string]string{}
	if name == "" {
		errors["name"] = "The name field is required."
	}
	if email == "" {
		errors["email"] = "The email field is required."
	}
	if password == "" {
		errors["password"] = "The password field is required."
	}
	if password != passwordConfirmation {
		errors["password"] = "The password confirmation does not match."
	}
	if len(password) < 8 {
		errors["password"] = "The password must be at least 8 characters."
	}

	// Check if email exists
	if email != "" {
		_, err := h.q.FindUserByEmail(r.Context(), email)
		if err == nil {
			errors["email"] = "The email has already been taken."
		}
	}

	if len(errors) > 0 {
		validationError(w, r, h.inertia, errors)
		return
	}

	hashedPassword, err := auth.HashPassword(password)
	if err != nil {
		http.Error(w, "Internal error", http.StatusInternalServerError)
		return
	}

	feverKey := auth.FeverAPIKey(email, password)
	now := time.Now()
	user, err := h.q.CreateUser(r.Context(), db.CreateUserParams{
		Name:        name,
		Email:       email,
		Password:    hashedPassword,
		FeverAPIKey: &feverKey,
		CreatedAt:   &now,
	})
	if err != nil {
		http.Error(w, "Could not create account", http.StatusInternalServerError)
		return
	}

	go h.telegram.NotifyRegistration(name, email)

	_ = h.auth.Login(w, r, user.ID)
	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	_ = h.auth.Logout(w, r)
	http.Redirect(w, r, "/", http.StatusFound)
}

func (h *AuthHandler) ShowTwoFactorChallenge(w http.ResponseWriter, r *http.Request) {
	render(w, r, h.inertia, "Auth/TwoFactorChallenge")
}

func (h *AuthHandler) TwoFactorChallenge(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	userID, _, ok := h.auth.Get2FAChallenge(r)
	if !ok {
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}

	user, err := h.q.FindUserByID(r.Context(), userID)
	if err != nil {
		http.Redirect(w, r, "/login", http.StatusFound)
		return
	}

	code := form.Get("code")
	recoveryCode := form.Get("recovery_code")

	if code != "" {
		// TOTP validation
		if user.TwoFactorSecret == nil || !totp.Validate(code, *user.TwoFactorSecret) {
			validationError(w, r, h.inertia, map[string]string{"code": "The provided two factor authentication code was invalid."})
			return
		}
	} else if recoveryCode != "" {
		// Recovery code validation
		if user.TwoFactorRecoveryCodes == nil {
			validationError(w, r, h.inertia, map[string]string{"recovery_code": "The provided recovery code was invalid."})
			return
		}
		var codes []string
		_ = json.Unmarshal([]byte(*user.TwoFactorRecoveryCodes), &codes)
		found := false
		var remaining []string
		for _, c := range codes {
			if c == recoveryCode && !found {
				found = true
			} else {
				remaining = append(remaining, c)
			}
		}
		if !found {
			validationError(w, r, h.inertia, map[string]string{"recovery_code": "The provided recovery code was invalid."})
			return
		}
		// Update remaining codes
		codesJSON, _ := json.Marshal(remaining)
		codesStr := string(codesJSON)
		_ = h.q.UpdateUserTwoFactor(r.Context(), db.UpdateUserTwoFactorParams{
			ID:                     user.ID,
			TwoFactorSecret:        user.TwoFactorSecret,
			TwoFactorRecoveryCodes: &codesStr,
			TwoFactorConfirmedAt:   user.TwoFactorConfirmedAt,
		})
	} else {
		validationError(w, r, h.inertia, map[string]string{"code": "Please provide a code or recovery code."})
		return
	}

	_ = h.auth.Login(w, r, user.ID)
	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *AuthHandler) ShowForgotPassword(w http.ResponseWriter, r *http.Request) {
	render(w, r, h.inertia, "Auth/ForgotPassword", gonertia.Props{
		"status": h.auth.GetFlash(w, r, "status"),
	})
}

func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}
	email := strings.ToLower(strings.TrimSpace(form.Get("email")))
	if email == "" {
		validationError(w, r, h.inertia, map[string]string{"email": "The email field is required."})
		return
	}

	// Always show success to prevent email enumeration
	_, err = h.q.FindUserByEmail(r.Context(), email)
	if err == nil {
		token := generatePlainToken(64)
		_ = h.q.CreatePasswordReset(r.Context(), db.CreatePasswordResetParams{Email: email, Token: db.HashToken(token)})
		// TODO: Send email with reset link
	}

	h.auth.SetFlash(w, r, "status", "We have emailed your password reset link.")
	http.Redirect(w, r, "/forgot-password", http.StatusFound)
}

func (h *AuthHandler) ShowResetPassword(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	render(w, r, h.inertia, "Auth/ResetPassword", gonertia.Props{
		"email": r.URL.Query().Get("email"),
		"token": token,
	})
}

func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(form.Get("email")))
	password := form.Get("password")
	passwordConfirmation := form.Get("password_confirmation")
	token := form.Get("token")

	errors := map[string]string{}
	if password == "" {
		errors["password"] = "The password field is required."
	}
	if password != passwordConfirmation {
		errors["password"] = "The password confirmation does not match."
	}
	if len(password) < 8 {
		errors["password"] = "The password must be at least 8 characters."
	}

	if len(errors) > 0 {
		validationError(w, r, h.inertia, errors)
		return
	}

	// Verify token
	resetToken, err := h.q.FindPasswordReset(r.Context(), email)
	if err != nil || !checkTokenHash(token, resetToken.Token) {
		validationError(w, r, h.inertia, map[string]string{"email": "This password reset token is invalid."})
		return
	}

	user, err := h.q.FindUserByEmail(r.Context(), email)
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"email": "We can't find a user with that email address."})
		return
	}

	hashedPassword, _ := auth.HashPassword(password)
	feverKey := auth.FeverAPIKey(email, password)
	_ = h.q.UpdateUserPasswordAndFeverKey(r.Context(), db.UpdateUserPasswordAndFeverKeyParams{
		ID:          user.ID,
		Password:    hashedPassword,
		FeverAPIKey: &feverKey,
	})
	_ = h.q.DeletePasswordReset(r.Context(), email)

	h.auth.SetFlash(w, r, "status", "Your password has been reset.")
	http.Redirect(w, r, "/login", http.StatusFound)
}

func (h *AuthHandler) ShowVerifyEmail(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	if user.EmailVerifiedAt != nil {
		http.Redirect(w, r, "/feeds?verified=1", http.StatusFound)
		return
	}
	render(w, r, h.inertia, "Auth/VerifyEmail", gonertia.Props{
		"status": h.auth.GetFlash(w, r, "status"),
	})
}

func (h *AuthHandler) SendVerificationEmail(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	if user.EmailVerifiedAt != nil {
		http.Redirect(w, r, "/feeds", http.StatusFound)
		return
	}
	// TODO: Send verification email
	h.auth.SetFlash(w, r, "status", "verification-link-sent")
	http.Redirect(w, r, "/verify-email", http.StatusFound)
}

func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	if user.EmailVerifiedAt != nil {
		http.Redirect(w, r, "/feeds?verified=1", http.StatusFound)
		return
	}
	// TODO: Verify signed URL
	_ = h.q.VerifyUserEmail(r.Context(), user.ID)
	http.Redirect(w, r, "/feeds?verified=1", http.StatusFound)
}

func (h *AuthHandler) ShowConfirmPassword(w http.ResponseWriter, r *http.Request) {
	render(w, r, h.inertia, "Auth/ConfirmPassword")
}

func (h *AuthHandler) ConfirmPassword(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	password := form.Get("password")

	if !auth.CheckPassword(user.Password, password) {
		validationError(w, r, h.inertia, map[string]string{"password": "The provided password was incorrect."})
		return
	}

	// Store confirmation in session
	session := h.auth.GetSession(r)
	session.Values["password_confirmed"] = true
	_ = session.Save(r, w)

	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *AuthHandler) UpdatePassword(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	currentPassword := form.Get("current_password")
	newPassword := form.Get("password")
	confirmation := form.Get("password_confirmation")

	errors := map[string]string{}
	if !auth.CheckPassword(user.Password, currentPassword) {
		errors["current_password"] = "The provided password does not match your current password."
	}
	if newPassword == "" || len(newPassword) < 8 {
		errors["password"] = "The password must be at least 8 characters."
	}
	if newPassword != confirmation {
		errors["password"] = "The password confirmation does not match."
	}

	if len(errors) > 0 {
		validationError(w, r, h.inertia, errors)
		return
	}

	hashedPassword, _ := auth.HashPassword(newPassword)
	_ = h.q.UpdateUserPassword(r.Context(), db.UpdateUserPasswordParams{ID: user.ID, Password: hashedPassword})

	http.Redirect(w, r, "/profile", http.StatusFound)
}

// Helpers

func validationError(w http.ResponseWriter, r *http.Request, i *gonertia.Inertia, errors map[string]string) {
	// Convert to gonertia ValidationErrors and set in context for flash provider
	ve := gonertia.ValidationErrors{}
	for k, v := range errors {
		ve[k] = v
	}
	ctx := gonertia.SetValidationErrors(r.Context(), ve)
	r = r.WithContext(ctx)
	i.Back(w, r)
}

func generatePlainToken(length int) string {
	return db.GeneratePlainToken(length)
}

func checkTokenHash(plaintext, hash string) bool {
	return db.HashToken(plaintext) == hash
}

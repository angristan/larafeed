package handler

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/pquerna/otp/totp"
	gonertia "github.com/romsar/gonertia/v2"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Remember bool   `json:"remember"`
}

type registerRequest struct {
	Name                 string `json:"name" validate:"required,max=255"`
	Email                string `json:"email" validate:"required,max=255"`
	Password             string `json:"password" validate:"required,min=8,max=255,eqfield=PasswordConfirmation"`
	PasswordConfirmation string `json:"password_confirmation"`
}

type twoFactorChallengeRequest struct {
	Code         string `json:"code"`
	RecoveryCode string `json:"recovery_code"`
}

type forgotPasswordRequest struct {
	Email string `json:"email" validate:"required,max=255"`
}

type resetPasswordRequest struct {
	Email                string `json:"email"`
	Password             string `json:"password" validate:"required,min=8,max=255,eqfield=PasswordConfirmation"`
	PasswordConfirmation string `json:"password_confirmation"`
	Token                string `json:"token"`
}

type confirmPasswordRequest struct {
	Password string `json:"password"`
}

type updatePasswordRequest struct {
	CurrentPassword      string `json:"current_password"`
	Password             string `json:"password" validate:"required,min=8,max=255,eqfield=PasswordConfirmation"`
	PasswordConfirmation string `json:"password_confirmation"`
}

type AuthHandler struct {
	inertia  *gonertia.Inertia
	auth     *auth.Auth
	q        authQuerier
	cfg      *config.Config
	telegram telegramService
}

func NewAuthHandler(i *gonertia.Inertia, a *auth.Auth, q authQuerier, cfg *config.Config, telegram telegramService) *AuthHandler {
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
	req, err := decodeRequest[loginRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	user, err := h.q.FindUserByEmail(r.Context(), req.Email)
	if err != nil || !auth.CheckPassword(user.Password, req.Password) {
		ip := r.RemoteAddr
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			ip = strings.Split(fwd, ",")[0]
		}
		go h.telegram.NotifyLoginFailure(req.Email, ip)

		validationError(w, r, h.inertia, map[string]string{"email": "These credentials do not match our records."})
		return
	}

	// Check for 2FA
	if user.TwoFactorSecret != nil && *user.TwoFactorSecret != "" {
		_ = h.auth.Set2FAChallenge(w, r, user.ID, req.Remember)
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
		renderError(w, r, h.inertia, http.StatusForbidden)
		return
	}

	req, err := decodeRequest[registerRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	if errs := validateRequest(req); errs != nil {
		validationError(w, r, h.inertia, errs)
		return
	}

	if _, err := h.q.FindUserByEmail(r.Context(), req.Email); err == nil {
		validationError(w, r, h.inertia, map[string]string{"email": "The email has already been taken."})
		return
	}

	hashedPassword, err := auth.HashPassword(req.Password)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
	}

	feverKey := auth.FeverAPIKey(req.Email, req.Password)
	now := time.Now()
	user, err := h.q.CreateUser(r.Context(), db.CreateUserParams{
		Name:        req.Name,
		Email:       req.Email,
		Password:    hashedPassword,
		FeverAPIKey: &feverKey,
		CreatedAt:   &now,
	})
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
	}

	go h.telegram.NotifyRegistration(req.Name, req.Email)

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
	req, err := decodeRequest[twoFactorChallengeRequest](r)
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

	if req.Code != "" {
		// TOTP validation
		if user.TwoFactorSecret == nil || !totp.Validate(req.Code, *user.TwoFactorSecret) {
			validationError(w, r, h.inertia, map[string]string{"code": "The provided two factor authentication code was invalid."})
			return
		}
	} else if req.RecoveryCode != "" {
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
			if c == req.RecoveryCode && !found {
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
	req, err := decodeRequest[forgotPasswordRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	if errs := validateRequest(req); errs != nil {
		validationError(w, r, h.inertia, errs)
		return
	}

	// Always show success to prevent email enumeration
	_, err = h.q.FindUserByEmail(r.Context(), req.Email)
	if err == nil {
		token := generatePlainToken(64)
		_ = h.q.CreatePasswordReset(r.Context(), db.CreatePasswordResetParams{Email: req.Email, Token: db.HashToken(token)})
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
	req, err := decodeRequest[resetPasswordRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	if errs := validateRequest(req); errs != nil {
		validationError(w, r, h.inertia, errs)
		return
	}

	// Verify token
	resetToken, err := h.q.FindPasswordReset(r.Context(), req.Email)
	if err != nil || !checkTokenHash(req.Token, resetToken.Token) {
		validationError(w, r, h.inertia, map[string]string{"email": "This password reset token is invalid."})
		return
	}

	user, err := h.q.FindUserByEmail(r.Context(), req.Email)
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"email": "We can't find a user with that email address."})
		return
	}

	hashedPassword, _ := auth.HashPassword(req.Password)
	feverKey := auth.FeverAPIKey(req.Email, req.Password)
	_ = h.q.UpdateUserPasswordAndFeverKey(r.Context(), db.UpdateUserPasswordAndFeverKeyParams{
		ID:          user.ID,
		Password:    hashedPassword,
		FeverAPIKey: &feverKey,
	})
	_ = h.q.DeletePasswordReset(r.Context(), req.Email)

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
	req, err := decodeRequest[confirmPasswordRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)

	if !auth.CheckPassword(user.Password, req.Password) {
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
	req, err := decodeRequest[updatePasswordRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)

	if errs := validateRequest(req); errs != nil {
		validationError(w, r, h.inertia, errs)
		return
	}

	if !auth.CheckPassword(user.Password, req.CurrentPassword) {
		validationError(w, r, h.inertia, map[string]string{"current_password": "The provided password does not match your current password."})
		return
	}

	hashedPassword, _ := auth.HashPassword(req.Password)
	_ = h.q.UpdateUserPassword(r.Context(), db.UpdateUserPasswordParams{ID: user.ID, Password: hashedPassword})

	http.Redirect(w, r, "/profile", http.StatusFound)
}

// Helpers

func generatePlainToken(length int) string {
	return db.GeneratePlainToken(length)
}

func checkTokenHash(plaintext, hash string) bool {
	return db.HashToken(plaintext) == hash
}

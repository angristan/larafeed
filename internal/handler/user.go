package handler

import (
	"net/http"
	"strings"

	"github.com/angristan/larafeed-go/internal/auth"
	gonertia "github.com/romsar/gonertia/v2"
)

type updateProfileRequest struct {
	Name  string `json:"name" validate:"required,max=255"`
	Email string `json:"email" validate:"required,max=255"`
}

type deleteAccountRequest struct {
	Password string `json:"password"`
}

type UserHandler struct {
	inertia *gonertia.Inertia
	authSvc *auth.Auth
	userSvc userService
}

func NewUserHandler(i *gonertia.Inertia, a *auth.Auth, userSvc userService) *UserHandler {
	return &UserHandler{inertia: i, authSvc: a, userSvc: userSvc}
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
		renderError(w, r, h.inertia, http.StatusInternalServerError)
	}
}

func (h *UserHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest[updateProfileRequest](r)
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

	user := auth.UserFromRequest(r)

	if err := h.userSvc.UpdateProfile(r.Context(), user.ID, user.Email, req.Name, req.Email); err != nil {
		if !handleServiceError(w, r, h.inertia, err) {
			renderError(w, r, h.inertia, http.StatusInternalServerError)
		}
		return
	}

	http.Redirect(w, r, "/profile", http.StatusFound)
}

func (h *UserHandler) DeleteAccount(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest[deleteAccountRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)

	if !auth.CheckPassword(user.Password, req.Password) {
		validationError(w, r, h.inertia, map[string]string{"password": "The provided password is incorrect."})
		return
	}

	_ = h.authSvc.Logout(w, r)
	if err := h.userSvc.DeleteAccount(r.Context(), user.ID); err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, "/", http.StatusFound)
}

func (h *UserHandler) WipeAccount(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	if err := h.userSvc.WipeAccount(r.Context(), user.ID); err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

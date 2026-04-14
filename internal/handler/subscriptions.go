package handler

import (
	"net/http"

	"github.com/angristan/larafeed-go/internal/auth"
	gonertia "github.com/romsar/gonertia/v2"
)

type SubscriptionsHandler struct {
	inertia *gonertia.Inertia
	subsSvc subscriptionService
}

func NewSubscriptionsHandler(i *gonertia.Inertia, subsSvc subscriptionService) *SubscriptionsHandler {
	return &SubscriptionsHandler{inertia: i, subsSvc: subsSvc}
}

func (h *SubscriptionsHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	feeds, err := h.subsSvc.ListSubscriptions(r.Context(), user.ID)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError, err)
		return
	}
	cats, err := h.subsSvc.ListCategories(r.Context(), user.ID)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError, err)
		return
	}

	render(w, r, h.inertia, "Subscriptions", gonertia.Props{
		"feeds":      feeds,
		"categories": cats,
	})
}

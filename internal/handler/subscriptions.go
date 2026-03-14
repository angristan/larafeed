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

	render(w, r, h.inertia, "Subscriptions", gonertia.Props{
		"feeds":      h.subsSvc.ListSubscriptions(r.Context(), user.ID),
		"categories": h.subsSvc.ListCategories(r.Context(), user.ID),
	})
}

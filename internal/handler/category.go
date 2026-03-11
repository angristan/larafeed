package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/go-chi/chi/v5"
	gonertia "github.com/romsar/gonertia/v2"
)

type CategoryHandler struct {
	inertia *gonertia.Inertia
	q       *db.Queries
}

func NewCategoryHandler(i *gonertia.Inertia, q *db.Queries) *CategoryHandler {
	return &CategoryHandler{inertia: i, q: q}
}

func (h *CategoryHandler) Create(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	name := strings.TrimSpace(form.Get("categoryName"))

	if name == "" {
		validationError(w, r, h.inertia, map[string]string{"categoryName": "The category name is required."})
		return
	}
	if len(name) > 20 {
		validationError(w, r, h.inertia, map[string]string{"categoryName": "The category name must not exceed 20 characters."})
		return
	}

	_, err = h.q.CreateCategory(r.Context(), db.CreateCategoryParams{UserID: user.ID, Name: name})
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"categoryName": "A category with this name already exists."})
		return
	}

	http.Redirect(w, r, "/feeds", http.StatusFound)
}

func (h *CategoryHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	categoryID, err := strconv.ParseInt(chi.URLParam(r, "category_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid category ID", http.StatusBadRequest)
		return
	}

	// Verify ownership
	cat, err := h.q.FindCategoryByID(r.Context(), categoryID)
	if err != nil || cat.UserID != user.ID {
		http.Error(w, "Category not found", http.StatusNotFound)
		return
	}

	// Check for subscriptions
	count, _ := h.q.CategoryHasSubscriptions(r.Context(), categoryID)
	if count > 0 {
		validationError(w, r, h.inertia, map[string]string{"category": "Cannot delete a category that has feed subscriptions."})
		return
	}

	_ = h.q.DeleteCategory(r.Context(), categoryID)
	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

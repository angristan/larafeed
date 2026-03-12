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

type createCategoryRequest struct {
	CategoryName string `json:"categoryName" validate:"required,max=20" label:"category name"`
}

type CategoryHandler struct {
	inertia *gonertia.Inertia
	q       *db.Queries
}

func NewCategoryHandler(i *gonertia.Inertia, q *db.Queries) *CategoryHandler {
	return &CategoryHandler{inertia: i, q: q}
}

func (h *CategoryHandler) Create(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest[createCategoryRequest](r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	req.CategoryName = strings.TrimSpace(req.CategoryName)

	if errs := validateRequest(req); errs != nil {
		validationError(w, r, h.inertia, errs)
		return
	}

	user := auth.UserFromRequest(r)

	_, err = h.q.CreateCategory(r.Context(), db.CreateCategoryParams{UserID: user.ID, Name: req.CategoryName})
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

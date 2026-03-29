package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/go-chi/chi/v5"
	gonertia "github.com/romsar/gonertia/v2"
)

type createCategoryRequest struct {
	CategoryName string `json:"categoryName" validate:"required,max=20" label:"category name"`
}

type CategoryHandler struct {
	inertia    *gonertia.Inertia
	categorySvc categoryService
}

func NewCategoryHandler(i *gonertia.Inertia, categorySvc categoryService) *CategoryHandler {
	return &CategoryHandler{inertia: i, categorySvc: categorySvc}
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

	_, err = h.categorySvc.Create(r.Context(), user.ID, req.CategoryName)
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"categoryName": err.Error()})
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

	err = h.categorySvc.Delete(r.Context(), user.ID, categoryID)
	if err != nil {
		if !handleServiceError(w, r, h.inertia, err) {
			renderError(w, r, h.inertia, http.StatusInternalServerError)
		}
		return
	}

	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

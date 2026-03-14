package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/angristan/larafeed-go/internal/apperr"
	gonertia "github.com/romsar/gonertia/v2"
)

// render is a helper that logs and responds with 500 if Inertia rendering fails.
func render(w http.ResponseWriter, r *http.Request, i *gonertia.Inertia, component string, props ...gonertia.Props) {
	var err error
	if len(props) > 0 {
		err = i.Render(w, r, component, props[0])
	} else {
		err = i.Render(w, r, component)
	}
	if err != nil {
		slog.ErrorContext(r.Context(), "render error", "component", component, "error", err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

// RenderError renders the Inertia Error page (exported for use in server/middleware).
func RenderError(w http.ResponseWriter, r *http.Request, i *gonertia.Inertia, status int) {
	renderError(w, r, i, status)
}

// renderError renders the Inertia Error page with the given HTTP status code.
// For initial page loads it also sets the correct HTTP status on the response.
func renderError(w http.ResponseWriter, r *http.Request, i *gonertia.Inertia, status int) {
	// Set HTTP status for non-Inertia (initial page load) requests.
	// For Inertia XHR requests, gonertia sets 200 internally, but the
	// Error component receives the status as a prop so the UI is correct.
	if !gonertia.IsInertiaRequest(r) {
		w.WriteHeader(status)
	}
	if err := i.Render(w, r, "Error", gonertia.Props{"status": status}); err != nil {
		slog.ErrorContext(r.Context(), "render error page failed", "status", status, "error", err)
		http.Error(w, http.StatusText(status), status)
	}
}

// handleServiceError inspects err for structured apperr types and writes the
// appropriate HTTP response. Returns true if handled, false if the caller
// should fall back to a generic error response.
func handleServiceError(w http.ResponseWriter, r *http.Request, i *gonertia.Inertia, err error) bool {
	if err == nil {
		return false
	}

	var notFound *apperr.NotFoundError
	if errors.As(err, &notFound) {
		renderError(w, r, i, http.StatusNotFound)
		return true
	}

	var validErr *apperr.ValidationError
	if errors.As(err, &validErr) {
		validationError(w, r, i, map[string]string{validErr.Field: validErr.Message})
		return true
	}

	var conflict *apperr.ConflictError
	if errors.As(err, &conflict) {
		renderError(w, r, i, http.StatusConflict)
		return true
	}

	return false
}

// handleServiceErrorJSON is like handleServiceError but writes JSON responses
// instead of Inertia pages. Suitable for API-style endpoints.
func handleServiceErrorJSON(w http.ResponseWriter, err error) bool {
	if err == nil {
		return false
	}

	var notFound *apperr.NotFoundError
	if errors.As(err, &notFound) {
		jsonResponse(w, http.StatusNotFound, map[string]string{"error": notFound.Error()})
		return true
	}

	var validErr *apperr.ValidationError
	if errors.As(err, &validErr) {
		jsonResponse(w, http.StatusUnprocessableEntity, map[string]string{"error": validErr.Message})
		return true
	}

	var conflict *apperr.ConflictError
	if errors.As(err, &conflict) {
		jsonResponse(w, http.StatusConflict, map[string]string{"error": conflict.Error()})
		return true
	}

	return false
}

// decodeRequest decodes the JSON request body into a typed struct.
// All Inertia POST/PUT/PATCH/DELETE requests send JSON.
func decodeRequest[T any](r *http.Request) (T, error) {
	var req T
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, fmt.Errorf("decode request: %w", err)
	}
	return req, nil
}

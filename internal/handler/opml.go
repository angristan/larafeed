package handler

import (
	"net/http"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/service"
	gonertia "github.com/romsar/gonertia/v2"
)

type OPMLHandler struct {
	inertia *gonertia.Inertia
	opml    *service.OPMLService
	authSvc *auth.Auth
}

func NewOPMLHandler(i *gonertia.Inertia, opml *service.OPMLService, a *auth.Auth) *OPMLHandler {
	return &OPMLHandler{inertia: i, opml: opml, authSvc: a}
}

func (h *OPMLHandler) ShowImport(w http.ResponseWriter, r *http.Request) {
	render(w, r, h.inertia, "Import", gonertia.Props{
		"status": h.authSvc.GetFlash(w, r, "status"),
	})
}

func (h *OPMLHandler) Import(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	file, _, err := r.FormFile("opml_file")
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"opml_file": "Please select an OPML file."})
		return
	}
	defer file.Close()

	if err := h.opml.Import(r.Context(), user.ID, file); err != nil {
		validationError(w, r, h.inertia, map[string]string{"opml_file": "Failed to import OPML: " + err.Error()})
		return
	}

	h.authSvc.SetFlash(w, r, "status", "OPML imported successfully.")
	http.Redirect(w, r, "/profile?section=opml", http.StatusFound)
}

func (h *OPMLHandler) Export(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	data, err := h.opml.Export(r.Context(), user.ID)
	if err != nil {
		http.Error(w, "Failed to export OPML", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/xml")
	w.Header().Set("Content-Disposition", "attachment; filename=larafeed-export.opml")
	_, _ = w.Write(data)
}

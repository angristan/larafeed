package handler

import (
	"context"
	"log"
	"net/http"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	gonertia "github.com/romsar/gonertia/v2"
)

// ImportOPMLFeedArgs must match worker.ImportOPMLFeedArgs for River dispatch.
type ImportOPMLFeedArgs struct {
	UserID       int64  `json:"user_id"`
	FeedURL      string `json:"feed_url"`
	CategoryID   int64  `json:"category_id"`
	FallbackName string `json:"fallback_name"`
}

func (ImportOPMLFeedArgs) Kind() string { return "import_opml_feed" }

type OPMLHandler struct {
	inertia     *gonertia.Inertia
	opml        *service.OPMLService
	authSvc     *auth.Auth
	q           *db.Queries
	riverClient *river.Client[pgx.Tx]
}

func NewOPMLHandler(i *gonertia.Inertia, opml *service.OPMLService, a *auth.Auth, q *db.Queries) *OPMLHandler {
	return &OPMLHandler{inertia: i, opml: opml, authSvc: a, q: q}
}

// SetRiverClient sets the River client for async job dispatch.
// Called from main() after the River client is created.
func (h *OPMLHandler) SetRiverClient(rc *river.Client[pgx.Tx]) {
	h.riverClient = rc
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

	// Parse OPML to get feed list
	imports, err := h.opml.ParseOPML(r.Context(), user.ID, file)
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"opml_file": "Failed to parse OPML: " + err.Error()})
		return
	}

	// Dispatch async jobs for each feed
	dispatched := 0
	for _, imp := range imports {
		cat, err := h.q.FindOrCreateCategory(r.Context(), db.FindOrCreateCategoryParams{
			UserID: user.ID,
			Name:   imp.CategoryName,
		})
		if err != nil {
			continue
		}

		_, err = h.riverClient.Insert(context.Background(), ImportOPMLFeedArgs{
			UserID:       user.ID,
			FeedURL:      imp.FeedURL,
			CategoryID:   cat.ID,
			FallbackName: imp.FallbackName,
		}, nil)
		if err != nil {
			log.Printf("Failed to enqueue OPML feed import for %s: %v", imp.FeedURL, err)
			continue
		}
		dispatched++
	}

	log.Printf("OPML import: dispatched %d/%d feed jobs for user %d", dispatched, len(imports), user.ID)

	h.authSvc.SetFlash(w, r, "status", "OPML imported successfully. Feeds are being added in the background.")
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
	w.Header().Set("Content-Disposition", "attachment; filename=feeds.opml")
	_, _ = w.Write(data)
}

package handler

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/angristan/larafeed-go/internal/auth"
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
	opml        opmlService
	authSvc     *auth.Auth
	feedSvc     feedService
	riverClient *river.Client[pgx.Tx]
}

func NewOPMLHandler(i *gonertia.Inertia, opml opmlService, a *auth.Auth, feedSvc feedService) *OPMLHandler {
	return &OPMLHandler{inertia: i, opml: opml, authSvc: a, feedSvc: feedSvc}
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

	imports, err := h.opml.ParseOPML(r.Context(), user.ID, file)
	if err != nil {
		validationError(w, r, h.inertia, map[string]string{"opml_file": "Failed to parse OPML: " + err.Error()})
		return
	}

	dispatched := 0
	for _, imp := range imports {
		catID, err := h.feedSvc.ResolveCategory(r.Context(), user.ID, nil, imp.CategoryName)
		if err != nil {
			continue
		}

		_, err = h.riverClient.Insert(context.Background(), ImportOPMLFeedArgs{
			UserID:       user.ID,
			FeedURL:      imp.FeedURL,
			CategoryID:   catID,
			FallbackName: imp.FallbackName,
		}, nil)
		if err != nil {
			slog.Error("failed to enqueue OPML feed import", "feed_url", imp.FeedURL, "error", err)
			continue
		}
		dispatched++
	}

	slog.Info("OPML import dispatched", "dispatched", dispatched, "total", len(imports), "user_id", user.ID)

	h.authSvc.SetFlash(w, r, "status", "OPML imported successfully. Feeds are being added in the background.")
	http.Redirect(w, r, "/profile?section=opml", http.StatusFound)
}

func (h *OPMLHandler) Export(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)

	data, err := h.opml.Export(r.Context(), user.ID)
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/xml")
	w.Header().Set("Content-Disposition", "attachment; filename=feeds.opml")
	_, _ = w.Write(data)
}

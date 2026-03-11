package handler

import (
	"net/http"
	"strconv"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/go-chi/chi/v5"
)

type EntryHandler struct {
	q *db.Queries
}

func NewEntryHandler(q *db.Queries) *EntryHandler {
	return &EntryHandler{q: q}
}

func (h *EntryHandler) Update(w http.ResponseWriter, r *http.Request) {
	form, err := parseFormData(r)
	if err != nil {
		http.Error(w, "Bad request", http.StatusBadRequest)
		return
	}

	user := auth.UserFromRequest(r)
	entryID, err := strconv.ParseInt(chi.URLParam(r, "entry_id"), 10, 64)
	if err != nil {
		http.Error(w, "Invalid entry ID", http.StatusBadRequest)
		return
	}

	if form.Get("read") != "" {
		if form.GetBool("read") {
			_ = h.q.MarkAsRead(r.Context(), db.MarkAsReadParams{UserID: user.ID, EntryID: entryID})
		} else {
			_ = h.q.MarkAsUnread(r.Context(), db.MarkAsUnreadParams{UserID: user.ID, EntryID: entryID})
		}
	}

	if form.Get("starred") != "" {
		if form.GetBool("starred") {
			_ = h.q.Favorite(r.Context(), db.FavoriteParams{UserID: user.ID, EntryID: entryID})
		} else {
			_ = h.q.Unfavorite(r.Context(), db.UnfavoriteParams{UserID: user.ID, EntryID: entryID})
		}
	}

	if form.Get("archived") != "" {
		if form.GetBool("archived") {
			_ = h.q.Archive(r.Context(), db.ArchiveParams{UserID: user.ID, EntryID: entryID})
		} else {
			_ = h.q.Unarchive(r.Context(), db.UnarchiveParams{UserID: user.ID, EntryID: entryID})
		}
	}

	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

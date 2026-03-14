package handler

import (
	"net/http"
	"strconv"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/go-chi/chi/v5"
)

type updateEntryRequest struct {
	Read     *bool `json:"read"`
	Starred  *bool `json:"starred"`
	Archived *bool `json:"archived"`
}

type EntryHandler struct {
	entrySvc entryService
}

func NewEntryHandler(entrySvc entryService) *EntryHandler {
	return &EntryHandler{entrySvc: entrySvc}
}

func (h *EntryHandler) Update(w http.ResponseWriter, r *http.Request) {
	req, err := decodeRequest[updateEntryRequest](r)
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

	if err := h.entrySvc.UpdateInteractions(r.Context(), user.ID, entryID, req.Read, req.Starred, req.Archived); err != nil {
		http.Error(w, "Failed to update entry", http.StatusInternalServerError)
		return
	}

	http.Redirect(w, r, r.Header.Get("Referer"), http.StatusFound)
}

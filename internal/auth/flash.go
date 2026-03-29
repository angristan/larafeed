package auth

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/gorilla/sessions"
	gonertia "github.com/romsar/gonertia/v2"
)

const (
	flashKeyErrors       = "_inertia_errors"
	flashKeyClearHistory = "_inertia_clear_history"
)

// FlashProvider implements gonertia.FlashProvider using gorilla sessions.
type FlashProvider struct {
	store       sessions.Store
	sessionName string
}

func NewFlashProvider(store sessions.Store, sessionName string) *FlashProvider {
	return &FlashProvider{store: store, sessionName: sessionName}
}

type flashContextKey string

const requestKey flashContextKey = "flash_request"
const writerKey flashContextKey = "flash_writer"

// InjectRequestContext returns middleware that injects the http.Request and ResponseWriter
// into the context so the FlashProvider can access them.
func InjectRequestContext(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), requestKey, r)
		ctx = context.WithValue(ctx, writerKey, w)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func (f *FlashProvider) FlashErrors(ctx context.Context, errors gonertia.ValidationErrors) error {
	r, w := f.reqWriter(ctx)
	if r == nil {
		return nil
	}
	session, storeErr := f.store.Get(r, f.sessionName)
	if storeErr != nil {
		slog.WarnContext(ctx, "session decode error", "error", storeErr)
	}
	b, err := json.Marshal(errors)
	if err != nil {
		return err
	}
	session.AddFlash(string(b), flashKeyErrors)
	return session.Save(r, w)
}

func (f *FlashProvider) GetErrors(ctx context.Context) (gonertia.ValidationErrors, error) {
	r, w := f.reqWriter(ctx)
	if r == nil {
		return nil, nil
	}
	session, err := f.store.Get(r, f.sessionName)
	if err != nil {
		slog.WarnContext(ctx, "session decode error", "error", err)
	}
	flashes := session.Flashes(flashKeyErrors)
	if len(flashes) == 0 {
		return nil, nil
	}
	// Save to clear the flash
	if err := session.Save(r, w); err != nil {
		slog.WarnContext(ctx, "failed to save session", "error", err)
	}

	var errors gonertia.ValidationErrors
	if s, ok := flashes[0].(string); ok {
		if err := json.Unmarshal([]byte(s), &errors); err != nil {
			return nil, err
		}
	}
	return errors, nil
}

func (f *FlashProvider) ShouldClearHistory(ctx context.Context) (bool, error) {
	r, w := f.reqWriter(ctx)
	if r == nil {
		return false, nil
	}
	session, err := f.store.Get(r, f.sessionName)
	if err != nil {
		slog.WarnContext(ctx, "session decode error", "error", err)
	}
	flashes := session.Flashes(flashKeyClearHistory)
	if len(flashes) == 0 {
		return false, nil
	}
	if err := session.Save(r, w); err != nil {
		slog.WarnContext(ctx, "failed to save session", "error", err)
	}
	if v, ok := flashes[0].(bool); ok {
		return v, nil
	}
	return false, nil
}

func (f *FlashProvider) FlashClearHistory(ctx context.Context) error {
	r, w := f.reqWriter(ctx)
	if r == nil {
		return nil
	}
	session, err := f.store.Get(r, f.sessionName)
	if err != nil {
		slog.WarnContext(ctx, "session decode error", "error", err)
	}
	session.AddFlash(true, flashKeyClearHistory)
	return session.Save(r, w)
}

func (f *FlashProvider) reqWriter(ctx context.Context) (*http.Request, http.ResponseWriter) {
	r, _ := ctx.Value(requestKey).(*http.Request)
	w, _ := ctx.Value(writerKey).(http.ResponseWriter)
	return r, w
}

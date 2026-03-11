package auth

import (
	"context"
	"encoding/json"
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
	session, _ := f.store.Get(r, f.sessionName)
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
	session, _ := f.store.Get(r, f.sessionName)
	flashes := session.Flashes(flashKeyErrors)
	if len(flashes) == 0 {
		return nil, nil
	}
	// Save to clear the flash
	_ = session.Save(r, w)

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
	session, _ := f.store.Get(r, f.sessionName)
	flashes := session.Flashes(flashKeyClearHistory)
	if len(flashes) == 0 {
		return false, nil
	}
	_ = session.Save(r, w)
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
	session, _ := f.store.Get(r, f.sessionName)
	session.AddFlash(true, flashKeyClearHistory)
	return session.Save(r, w)
}

func (f *FlashProvider) reqWriter(ctx context.Context) (*http.Request, http.ResponseWriter) {
	r, _ := ctx.Value(requestKey).(*http.Request)
	w, _ := ctx.Value(writerKey).(http.ResponseWriter)
	return r, w
}

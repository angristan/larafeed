package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

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
		log.Printf("Render %s error: %v", component, err)
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
	}
}

// formData provides uniform access to request data whether sent as JSON or form-encoded.
// Inertia sends POST/PUT/PATCH/DELETE as JSON; regular forms send URL-encoded.
type formData map[string]any

// parseFormData reads the request body. If Content-Type is JSON it decodes the body,
// otherwise it falls back to r.ParseForm so r.FormValue still works.
func parseFormData(r *http.Request) (formData, error) {
	ct := r.Header.Get("Content-Type")
	if strings.HasPrefix(ct, "application/json") {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			return nil, fmt.Errorf("read body: %w", err)
		}
		defer r.Body.Close()
		var data formData
		if err := json.Unmarshal(body, &data); err != nil {
			return nil, fmt.Errorf("decode json: %w", err)
		}
		return data, nil
	}
	if err := r.ParseForm(); err != nil {
		return nil, err
	}
	// Wrap r.FormValue so callers use the same API.
	data := formData{}
	for k, v := range r.Form {
		if len(v) > 0 {
			data[k] = v[0]
		}
	}
	return data, nil
}

// Get returns a string value for the given key, or "" if not present.
func (f formData) Get(key string) string {
	v, ok := f[key]
	if !ok {
		return ""
	}
	switch val := v.(type) {
	case string:
		return val
	case float64:
		// JSON numbers
		return fmt.Sprintf("%v", val)
	case bool:
		if val {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", val)
	}
}

// GetBool returns a boolean value for the given key.
func (f formData) GetBool(key string) bool {
	v, ok := f[key]
	if !ok {
		return false
	}
	switch val := v.(type) {
	case bool:
		return val
	case string:
		return val == "true" || val == "1"
	default:
		return false
	}
}

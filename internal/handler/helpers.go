package handler

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"

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

// decodeRequest decodes the JSON request body into a typed struct.
// All Inertia POST/PUT/PATCH/DELETE requests send JSON.
func decodeRequest[T any](r *http.Request) (T, error) {
	var req T
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		return req, fmt.Errorf("decode request: %w", err)
	}
	return req, nil
}

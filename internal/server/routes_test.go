package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandleHealthCheck(t *testing.T) {
	t.Parallel()

	request := httptest.NewRequest(http.MethodGet, "/up", nil)
	response := httptest.NewRecorder()

	handleHealthCheck(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "text/plain; charset=utf-8" {
		t.Fatalf("expected text content type, got %q", contentType)
	}
	if body := response.Body.String(); body != "OK" {
		t.Fatalf("expected body %q, got %q", "OK", body)
	}
}

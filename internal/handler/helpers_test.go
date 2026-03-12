package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDecodeRequest_JSON(t *testing.T) {
	type loginReq struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		Remember bool   `json:"remember"`
	}

	body := `{"email":"test@example.com","password":"secret","remember":true}`
	r := httptest.NewRequest("POST", "/login", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")

	req, err := decodeRequest[loginReq](r)
	require.NoError(t, err)

	assert.Equal(t, "test@example.com", req.Email)
	assert.Equal(t, "secret", req.Password)
	assert.True(t, req.Remember)
}

func TestDecodeRequest_NestedJSON(t *testing.T) {
	type filterRules struct {
		ExcludeTitle []string `json:"exclude_title"`
	}
	type updateReq struct {
		Name        string       `json:"name"`
		FilterRules *filterRules `json:"filter_rules"`
	}

	body := `{"name":"My Feed","filter_rules":{"exclude_title":["sponsor","ad"]}}`
	r := httptest.NewRequest("PATCH", "/feeds/1", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")

	req, err := decodeRequest[updateReq](r)
	require.NoError(t, err)

	assert.Equal(t, "My Feed", req.Name)
	require.NotNil(t, req.FilterRules)
	assert.Equal(t, []string{"sponsor", "ad"}, req.FilterRules.ExcludeTitle)
}

func TestDecodeRequest_OptionalBoolPointers(t *testing.T) {
	type entryReq struct {
		Read    *bool `json:"read"`
		Starred *bool `json:"starred"`
	}

	// Only "read" is sent
	body := `{"read":true}`
	r := httptest.NewRequest("PATCH", "/entries/1", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")

	req, err := decodeRequest[entryReq](r)
	require.NoError(t, err)

	require.NotNil(t, req.Read)
	assert.True(t, *req.Read)
	assert.Nil(t, req.Starred) // absent field stays nil
}

func TestDecodeRequest_InvalidJSON(t *testing.T) {
	type req struct {
		Name string `json:"name"`
	}

	r := httptest.NewRequest("POST", "/test", strings.NewReader("not json"))
	r.Header.Set("Content-Type", "application/json")

	_, err := decodeRequest[req](r)
	assert.Error(t, err)
}

func TestJsonResponse(t *testing.T) {
	w := httptest.NewRecorder()
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Body.String(), `"status":"ok"`)
}

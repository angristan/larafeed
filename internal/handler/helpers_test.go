package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseFormData_JSON(t *testing.T) {
	body := `{"email":"test@example.com","password":"secret","remember":true}`
	req := httptest.NewRequest("POST", "/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")

	form, err := parseFormData(req)
	require.NoError(t, err)

	assert.Equal(t, "test@example.com", form.Get("email"))
	assert.Equal(t, "secret", form.Get("password"))
	assert.True(t, form.GetBool("remember"))
}

func TestParseFormData_FormEncoded(t *testing.T) {
	body := "email=test%40example.com&password=secret&remember=1"
	req := httptest.NewRequest("POST", "/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	form, err := parseFormData(req)
	require.NoError(t, err)

	assert.Equal(t, "test@example.com", form.Get("email"))
	assert.Equal(t, "secret", form.Get("password"))
}

func TestFormData_Get(t *testing.T) {
	t.Run("returns string value", func(t *testing.T) {
		f := formData{"key": "value"}
		assert.Equal(t, "value", f.Get("key"))
	})

	t.Run("returns empty for missing key", func(t *testing.T) {
		f := formData{}
		assert.Equal(t, "", f.Get("missing"))
	})

	t.Run("converts float64 to string", func(t *testing.T) {
		f := formData{"num": float64(42)}
		assert.Equal(t, "42", f.Get("num"))
	})

	t.Run("converts bool to string", func(t *testing.T) {
		f := formData{"flag": true}
		assert.Equal(t, "true", f.Get("flag"))
		f2 := formData{"flag": false}
		assert.Equal(t, "false", f2.Get("flag"))
	})
}

func TestFormData_GetBool(t *testing.T) {
	t.Run("returns bool value", func(t *testing.T) {
		f := formData{"flag": true}
		assert.True(t, f.GetBool("flag"))
	})

	t.Run("returns false for missing key", func(t *testing.T) {
		f := formData{}
		assert.False(t, f.GetBool("missing"))
	})

	t.Run("parses string true/1", func(t *testing.T) {
		f := formData{"flag": "true"}
		assert.True(t, f.GetBool("flag"))
		f2 := formData{"flag": "1"}
		assert.True(t, f2.GetBool("flag"))
	})

	t.Run("parses string false/0", func(t *testing.T) {
		f := formData{"flag": "false"}
		assert.False(t, f.GetBool("flag"))
		f2 := formData{"flag": "0"}
		assert.False(t, f2.GetBool("flag"))
	})
}

func TestJsonResponse(t *testing.T) {
	w := httptest.NewRecorder()
	jsonResponse(w, http.StatusOK, map[string]string{"status": "ok"})

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
	assert.Contains(t, w.Body.String(), `"status":"ok"`)
}

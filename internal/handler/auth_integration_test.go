package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newAuthHandler(t *testing.T, pool *db.Pool, q *db.Queries) *AuthHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	cfg := &config.Config{RegistrationEnabled: true}
	telegram := service.NewTelegramService("", "")
	return NewAuthHandler(i, authSvc, q, cfg, telegram)
}

// --- Register ---

func TestRegister_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/register", `{
		"name": "Alice",
		"email": "alice@test.com",
		"password": "secret123",
		"password_confirmation": "secret123"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/feeds", w.Header().Get("Location"))

	// Verify user was created in DB
	user, err := q.FindUserByEmail(context.Background(), "alice@test.com")
	require.NoError(t, err)
	assert.Equal(t, "Alice", user.Name)
	assert.Equal(t, "alice@test.com", user.Email)
}

func TestRegister_NormalizesEmail(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/register", `{
		"name": "Alice",
		"email": "  ALICE@Test.COM  ",
		"password": "secret123",
		"password_confirmation": "secret123"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	user, err := q.FindUserByEmail(context.Background(), "alice@test.com")
	require.NoError(t, err)
	assert.Equal(t, "alice@test.com", user.Email)
}

func TestRegister_ValidationErrors_EmptyFields(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/register", `{
		"name": "",
		"email": "",
		"password": "",
		"password_confirmation": ""
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	// Should redirect back (validation error)
	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))

	// Verify no user was created
	_, err := q.FindUserByEmail(context.Background(), "")
	assert.Error(t, err)
}

func TestRegister_ValidationErrors_ShortPassword(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/register", `{
		"name": "Alice",
		"email": "alice@test.com",
		"password": "short",
		"password_confirmation": "short"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	// No user should be created
	_, err := q.FindUserByEmail(context.Background(), "alice@test.com")
	assert.Error(t, err)
}

func TestRegister_ValidationErrors_PasswordMismatch(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/register", `{
		"name": "Alice",
		"email": "alice@test.com",
		"password": "secret123",
		"password_confirmation": "different1"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	_, err := q.FindUserByEmail(context.Background(), "alice@test.com")
	assert.Error(t, err)
}

func TestRegister_DuplicateEmail(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	createUser(t, q, "Existing", "alice@test.com", "password123")

	r := jsonRequest("POST", "/register", `{
		"name": "Alice 2",
		"email": "alice@test.com",
		"password": "secret123",
		"password_confirmation": "secret123"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))
}

func TestRegister_Disabled(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	cfg := &config.Config{RegistrationEnabled: false}
	telegram := service.NewTelegramService("", "")
	h := NewAuthHandler(i, authSvc, q, cfg, telegram)

	r := jsonRequest("POST", "/register", `{
		"name": "Alice",
		"email": "alice@test.com",
		"password": "secret123",
		"password_confirmation": "secret123"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Register, w, r)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

// --- Login ---

func TestLogin_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("POST", "/login", `{
		"email": "alice@test.com",
		"password": "secret123"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Login, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/feeds", w.Header().Get("Location"))
	// Session cookie should be set
	assert.NotEmpty(t, w.Header().Get("Set-Cookie"))
}

func TestLogin_InvalidCredentials(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("POST", "/login", `{
		"email": "alice@test.com",
		"password": "wrong"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Login, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))
}

func TestLogin_NonexistentUser(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/login", `{
		"email": "nobody@test.com",
		"password": "secret123"
	}`)
	w := httptest.NewRecorder()
	callHandler(h.Login, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))
}

// --- UpdatePassword ---

func TestUpdatePassword_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "oldpassword1")

	r := jsonRequest("PUT", "/password", `{
		"current_password": "oldpassword1",
		"password": "newpassword1",
		"password_confirmation": "newpassword1"
	}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.UpdatePassword, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/profile", w.Header().Get("Location"))
}

func TestUpdatePassword_WrongCurrentPassword(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	user := createUser(t, q, "Alice", "alice@test.com", "oldpassword1")

	r := jsonRequest("PUT", "/password", `{
		"current_password": "wrongpassword",
		"password": "newpassword1",
		"password_confirmation": "newpassword1"
	}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.UpdatePassword, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/profile", w.Header().Get("Location"))
}

// --- ForgotPassword ---

func TestForgotPassword_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("POST", "/forgot-password", `{"email": "alice@test.com"}`)
	w := httptest.NewRecorder()
	callHandler(h.ForgotPassword, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/forgot-password", w.Header().Get("Location"))
}

func TestForgotPassword_EmptyEmail(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newAuthHandler(t, pool, q)

	r := jsonRequest("POST", "/forgot-password", `{"email": ""}`)
	w := httptest.NewRecorder()
	callHandler(h.ForgotPassword, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	// Should not redirect to /forgot-password (validation error redirects back)
	assert.NotEqual(t, "/forgot-password", w.Header().Get("Location"))
}

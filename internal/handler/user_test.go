package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newUserHandler(t *testing.T, pool *db.Pool, q *db.Queries) *UserHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	return NewUserHandler(i, pool, authSvc, q)
}

// --- UpdateProfile ---

func TestUpdateProfile_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newUserHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("PATCH", "/profile", `{
		"name": "Alice Updated",
		"email": "alice@test.com"
	}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.UpdateProfile, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/profile", w.Header().Get("Location"))

	updated, err := q.FindUserByID(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, "Alice Updated", updated.Name)
}

func TestUpdateProfile_EmptyName(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newUserHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("PATCH", "/profile", `{
		"name": "",
		"email": "alice@test.com"
	}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.UpdateProfile, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/profile", w.Header().Get("Location"))

	// Name should not have changed
	updated, err := q.FindUserByID(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, "Alice", updated.Name)
}

func TestUpdateProfile_DuplicateEmail(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newUserHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	createUser(t, q, "Bob", "bob@test.com", "secret123")

	r := jsonRequest("PATCH", "/profile", `{
		"name": "Alice",
		"email": "bob@test.com"
	}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.UpdateProfile, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/profile", w.Header().Get("Location"))

	// Email should not have changed
	updated, err := q.FindUserByID(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, "alice@test.com", updated.Email)
}

func TestUpdateProfile_ChangeEmail(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newUserHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("PATCH", "/profile", `{
		"name": "Alice",
		"email": "newalice@test.com"
	}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.UpdateProfile, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/profile", w.Header().Get("Location"))

	updated, err := q.FindUserByID(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Equal(t, "newalice@test.com", updated.Email)
}

// --- DeleteAccount ---

func TestDeleteAccount_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newUserHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("DELETE", "/profile", `{"password": "secret123"}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.DeleteAccount, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	// User should be deleted
	_, err := q.FindUserByID(context.Background(), user.ID)
	assert.Error(t, err)
}

func TestDeleteAccount_WrongPassword(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newUserHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("DELETE", "/profile", `{"password": "wrong"}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.DeleteAccount, w, r)

	assert.Equal(t, http.StatusFound, w.Code)

	// User should still exist
	_, err := q.FindUserByID(context.Background(), user.ID)
	assert.NoError(t, err)
}


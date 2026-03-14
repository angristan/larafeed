package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newCategoryHandler(t *testing.T, pool *db.Pool, q *db.Queries) *CategoryHandler {
	t.Helper()
	authSvc := testAuth(t, q)
	i := testInertia(t, authSvc)
	categorySvc := service.NewCategoryService(q)
	return NewCategoryHandler(i, categorySvc)
}

func TestCreateCategory_Success(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newCategoryHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("POST", "/categories", `{"categoryName": "Tech"}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Create, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "/feeds", w.Header().Get("Location"))

	cats, err := q.ListCategoriesForUser(context.Background(), user.ID)
	require.NoError(t, err)
	require.Len(t, cats, 1)
	assert.Equal(t, "Tech", cats[0].Name)
}

func TestCreateCategory_EmptyName(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newCategoryHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("POST", "/categories", `{"categoryName": ""}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Create, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))

	cats, err := q.ListCategoriesForUser(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Empty(t, cats)
}

func TestCreateCategory_NameTooLong(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newCategoryHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")

	r := jsonRequest("POST", "/categories", `{"categoryName": "This name is way too long!"}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Create, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))

	cats, err := q.ListCategoriesForUser(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Empty(t, cats)
}

func TestCreateCategory_Duplicate(t *testing.T) {
	pool := testPool(t)
	q := db.New(pool)
	h := newCategoryHandler(t, pool, q)
	user := createUser(t, q, "Alice", "alice@test.com", "secret123")
	createCategory(t, q, user.ID, "Tech")

	r := jsonRequest("POST", "/categories", `{"categoryName": "Tech"}`)
	r = withUser(r, user)
	w := httptest.NewRecorder()
	callHandler(h.Create, w, r)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.NotEqual(t, "/feeds", w.Header().Get("Location"))

	cats, err := q.ListCategoriesForUser(context.Background(), user.ID)
	require.NoError(t, err)
	assert.Len(t, cats, 1)
}

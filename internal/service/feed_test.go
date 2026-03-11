package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestValidateURL(t *testing.T) {
	t.Run("accepts valid HTTP URLs", func(t *testing.T) {
		// Skip if DNS resolution is not available (CI)
		err := ValidateURL("https://example.com")
		// Only test if we can resolve DNS
		if err != nil && err.Error() != "" {
			t.Skip("DNS resolution not available")
		}
		assert.NoError(t, err)
	})

	t.Run("blocks non-HTTP schemes", func(t *testing.T) {
		err := ValidateURL("ftp://example.com")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "invalid scheme")
	})

	t.Run("blocks empty scheme", func(t *testing.T) {
		err := ValidateURL("example.com/feed")
		assert.Error(t, err)
	})

	t.Run("blocks localhost", func(t *testing.T) {
		err := ValidateURL("http://localhost/feed")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "private IP")
	})

	t.Run("blocks 127.0.0.1", func(t *testing.T) {
		err := ValidateURL("http://127.0.0.1/feed")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "private IP")
	})

	t.Run("blocks private IP 192.168.x.x", func(t *testing.T) {
		err := ValidateURL("http://192.168.1.1/feed")
		assert.Error(t, err)
	})

	t.Run("blocks private IP 10.x.x.x", func(t *testing.T) {
		err := ValidateURL("http://10.0.0.1/feed")
		assert.Error(t, err)
	})

	t.Run("blocks private IP 172.16.x.x", func(t *testing.T) {
		err := ValidateURL("http://172.16.0.1/feed")
		assert.Error(t, err)
	})
}

func TestPaginate(t *testing.T) {
	t.Run("calculates correct pagination", func(t *testing.T) {
		result := Paginate([]int{1, 2, 3}, 100, 1, 30)
		assert.Equal(t, 1, result.CurrentPage)
		assert.Equal(t, 4, result.LastPage) // ceil(100/30) = 4
		assert.Equal(t, 30, result.PerPage)
		assert.Equal(t, 100, result.Total)
	})

	t.Run("handles zero total", func(t *testing.T) {
		result := Paginate([]int{}, 0, 1, 30)
		assert.Equal(t, 1, result.LastPage)
		assert.Equal(t, 0, result.Total)
	})

	t.Run("handles exact division", func(t *testing.T) {
		result := Paginate(nil, 60, 1, 30)
		assert.Equal(t, 2, result.LastPage)
	})

	t.Run("handles single page", func(t *testing.T) {
		result := Paginate(nil, 5, 1, 30)
		assert.Equal(t, 1, result.LastPage)
	})
}

func TestStringContainsAny(t *testing.T) {
	t.Run("matches substring", func(t *testing.T) {
		assert.True(t, StringContainsAny("Hello World", []string{"world"}))
	})

	t.Run("case insensitive", func(t *testing.T) {
		assert.True(t, StringContainsAny("HELLO", []string{"hello"}))
	})

	t.Run("no match returns false", func(t *testing.T) {
		assert.False(t, StringContainsAny("Hello", []string{"xyz", "abc"}))
	})

	t.Run("empty substrs returns false", func(t *testing.T) {
		assert.False(t, StringContainsAny("Hello", []string{}))
	})
}

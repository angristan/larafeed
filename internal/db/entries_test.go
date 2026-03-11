package db

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestReaderEntry_MarshalJSON(t *testing.T) {
	strPtr := func(s string) *string { return &s }
	boolPtr := func(b bool) *bool { return &b }

	t.Run("nests feed fields into feed sub-object", func(t *testing.T) {
		now := time.Now()
		entry := ReaderEntry{
			ID:          1,
			FeedID:      42,
			Title:       "Test Entry",
			URL:         "https://example.com/post",
			PublishedAt: now,
			FeedName:    "Example Feed",
			FaviconURL:  strPtr("https://example.com/favicon.ico"),
			FaviconIsDark: boolPtr(false),
		}

		data, err := json.Marshal(entry)
		require.NoError(t, err)

		var result map[string]any
		err = json.Unmarshal(data, &result)
		require.NoError(t, err)

		// Top-level fields
		assert.Equal(t, float64(1), result["id"])
		assert.Equal(t, "Test Entry", result["title"])
		assert.Equal(t, "https://example.com/post", result["url"])

		// Nested feed object
		feed, ok := result["feed"].(map[string]any)
		require.True(t, ok, "expected feed sub-object")
		assert.Equal(t, float64(42), feed["id"])
		assert.Equal(t, "Example Feed", feed["name"])
		assert.Equal(t, "https://example.com/favicon.ico", feed["favicon_url"])
		assert.Equal(t, false, feed["favicon_is_dark"])

		// Feed fields should NOT be at top level
		assert.Nil(t, result["feed_name"])
		assert.Nil(t, result["feed_id"])
		assert.Nil(t, result["favicon_url"])
	})

	t.Run("uses custom feed name when present", func(t *testing.T) {
		entry := ReaderEntry{
			ID:             1,
			FeedID:         42,
			Title:          "Test",
			URL:            "https://example.com",
			PublishedAt:    time.Now(),
			FeedName:       "Original Name",
			CustomFeedName: strPtr("Custom Name"),
		}

		data, err := json.Marshal(entry)
		require.NoError(t, err)

		var result map[string]any
		err = json.Unmarshal(data, &result)
		require.NoError(t, err)

		feed := result["feed"].(map[string]any)
		assert.Equal(t, "Custom Name", feed["name"])
	})

	t.Run("uses original name when custom name is empty", func(t *testing.T) {
		empty := ""
		entry := ReaderEntry{
			ID:             1,
			FeedID:         42,
			Title:          "Test",
			URL:            "https://example.com",
			PublishedAt:    time.Now(),
			FeedName:       "Original Name",
			CustomFeedName: &empty,
		}

		data, err := json.Marshal(entry)
		require.NoError(t, err)

		var result map[string]any
		err = json.Unmarshal(data, &result)
		require.NoError(t, err)

		feed := result["feed"].(map[string]any)
		assert.Equal(t, "Original Name", feed["name"])
	})

	t.Run("includes nullable fields", func(t *testing.T) {
		now := time.Now()
		entry := ReaderEntry{
			ID:          1,
			FeedID:      1,
			Title:       "Test",
			URL:         "https://example.com",
			PublishedAt: time.Now(),
			ReadAt:      &now,
			StarredAt:   &now,
			ArchivedAt:  nil,
			FeedName:    "Feed",
		}

		data, err := json.Marshal(entry)
		require.NoError(t, err)

		var result map[string]any
		err = json.Unmarshal(data, &result)
		require.NoError(t, err)

		assert.NotNil(t, result["read_at"])
		assert.NotNil(t, result["starred_at"])
		assert.Nil(t, result["archived_at"])
	})
}

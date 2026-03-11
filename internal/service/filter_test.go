package service

import (
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/stretchr/testify/assert"
)

func TestValidateFilterPattern(t *testing.T) {
	t.Run("accepts valid patterns", func(t *testing.T) {
		valid := []string{
			"alpha",
			"alpha-release",
			"alpha|beta",
			`v[0-9]+`,
			`-(alpha|beta|rc)\.\d+`,
			"[test]",
			`\bword\b`,
			"simple text",
			`^prefix`,
			`suffix$`,
			`foo.*bar`,
			"C++",
		}
		for _, p := range valid {
			assert.True(t, ValidateFilterPattern(p), "expected valid: %q", p)
		}
	})

	t.Run("rejects empty pattern", func(t *testing.T) {
		assert.False(t, ValidateFilterPattern(""))
	})

	t.Run("rejects nested quantifiers (ReDoS)", func(t *testing.T) {
		redos := []string{
			"(a+)+",
			"(a*)+",
			"(a+)*",
			"(a*)*",
			"(a+){2,}",
		}
		for _, p := range redos {
			assert.False(t, ValidateFilterPattern(p), "expected invalid (ReDoS): %q", p)
		}
	})

	t.Run("accepts invalid regex (falls back to substring)", func(t *testing.T) {
		// Invalid regex patterns are accepted because the runtime
		// falls back to substring matching
		assert.True(t, ValidateFilterPattern("[unclosed"))
		assert.True(t, ValidateFilterPattern("C++"))
	})
}

func TestEvaluateFilter(t *testing.T) {
	makeEntry := func(title string, content, author *string) db.Entry {
		return db.Entry{
			Title:   title,
			Content: content,
			Author:  author,
		}
	}

	t.Run("returns false when no filter rules", func(t *testing.T) {
		entry := makeEntry("Test Title", nil, nil)
		assert.False(t, EvaluateFilter(entry, nil))
	})

	t.Run("returns false when empty filter rules", func(t *testing.T) {
		entry := makeEntry("Test Title", nil, nil)
		assert.False(t, EvaluateFilter(entry, &FilterRules{}))
	})

	t.Run("filters entry by title substring", func(t *testing.T) {
		entry := makeEntry("v1.0.0-alpha.1 Release", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{"alpha"}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by title regex", func(t *testing.T) {
		entry := makeEntry("v1.0.0-rc.2 Release", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{`rc\.\d+`}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by title regex alternative", func(t *testing.T) {
		entry := makeEntry("v1.0.0-beta.1 Release", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{`alpha|beta|rc`}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("does not filter when title does not match", func(t *testing.T) {
		entry := makeEntry("v1.0.0 Stable Release", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{"alpha"}}
		assert.False(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by content", func(t *testing.T) {
		content := "This is a sponsored post"
		entry := makeEntry("Title", &content, nil)
		rules := &FilterRules{ExcludeContent: []string{"sponsored"}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by author", func(t *testing.T) {
		author := "AutoBot"
		entry := makeEntry("Title", nil, &author)
		rules := &FilterRules{ExcludeAuthor: []string{"bot"}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filter is case insensitive", func(t *testing.T) {
		entry := makeEntry("ALPHA Release", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{"alpha"}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("handles nil content gracefully", func(t *testing.T) {
		entry := makeEntry("Title", nil, nil)
		rules := &FilterRules{ExcludeContent: []string{"test"}}
		assert.False(t, EvaluateFilter(entry, rules))
	})

	t.Run("handles nil author gracefully", func(t *testing.T) {
		entry := makeEntry("Title", nil, nil)
		rules := &FilterRules{ExcludeAuthor: []string{"test"}}
		assert.False(t, EvaluateFilter(entry, rules))
	})

	t.Run("invalid regex falls back to substring match", func(t *testing.T) {
		entry := makeEntry("Title with [brackets]", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{"[brackets]"}}
		// [brackets] is valid regex (character class), but substring also matches
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("multiple patterns in same field", func(t *testing.T) {
		entry := makeEntry("Title", nil, nil)
		rules := &FilterRules{ExcludeTitle: []string{"nomatch", "Title"}}
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("multiple fields with patterns", func(t *testing.T) {
		content := "Sponsored content"
		author := "John"
		entry := makeEntry("Title", &content, &author)
		rules := &FilterRules{
			ExcludeTitle:   []string{"nomatch"},
			ExcludeContent: []string{"Sponsored"},
		}
		assert.True(t, EvaluateFilter(entry, rules))
	})
}

package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
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

func TestApplyFilters(t *testing.T) {
	makeEntry := func(id int64, title string) db.Entry {
		return db.Entry{ID: id, Title: title}
	}

	t.Run("marks matching entries as filtered", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewFilterService(q)

		rules := FilterRules{ExcludeTitle: []string{"alpha"}}
		rulesJSON, _ := json.Marshal(rules)

		sub := db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: rulesJSON}
		entries := []db.Entry{
			makeEntry(10, "v1.0-alpha release"),
			makeEntry(11, "v1.0 stable release"),
		}

		q.On("MarkFiltered", mock.Anything, db.MarkFilteredParams{UserID: 1, EntryID: 10}).Return(nil)
		q.On("ClearFiltered", mock.Anything, db.ClearFilteredParams{UserID: 1, EntryID: 11}).Return(nil)

		svc.ApplyFilters(context.Background(), sub, entries)

		q.AssertCalled(t, "MarkFiltered", mock.Anything, db.MarkFilteredParams{UserID: 1, EntryID: 10})
		q.AssertCalled(t, "ClearFiltered", mock.Anything, db.ClearFilteredParams{UserID: 1, EntryID: 11})
	})

	t.Run("clears all entries when no rules match", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewFilterService(q)

		rules := FilterRules{ExcludeTitle: []string{"nonexistent"}}
		rulesJSON, _ := json.Marshal(rules)

		sub := db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: rulesJSON}
		entries := []db.Entry{
			makeEntry(10, "First post"),
			makeEntry(11, "Second post"),
		}

		q.On("ClearFiltered", mock.Anything, mock.Anything).Return(nil)

		svc.ApplyFilters(context.Background(), sub, entries)

		q.AssertNumberOfCalls(t, "ClearFiltered", 2)
		q.AssertNotCalled(t, "MarkFiltered")
	})

	t.Run("no-op when filter rules are nil", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewFilterService(q)

		sub := db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: nil}
		entries := []db.Entry{makeEntry(10, "Post")}

		svc.ApplyFilters(context.Background(), sub, entries)

		q.AssertNotCalled(t, "MarkFiltered")
		q.AssertNotCalled(t, "ClearFiltered")
	})

	t.Run("no-op when filter rules JSON is invalid", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewFilterService(q)

		sub := db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: json.RawMessage(`{bad json`)}
		entries := []db.Entry{makeEntry(10, "Post")}

		svc.ApplyFilters(context.Background(), sub, entries)

		q.AssertNotCalled(t, "MarkFiltered")
		q.AssertNotCalled(t, "ClearFiltered")
	})

	t.Run("no-op when all rule lists are empty", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewFilterService(q)

		rules := FilterRules{}
		rulesJSON, _ := json.Marshal(rules)

		sub := db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: rulesJSON}
		entries := []db.Entry{makeEntry(10, "Post")}

		svc.ApplyFilters(context.Background(), sub, entries)

		q.AssertNotCalled(t, "MarkFiltered")
		q.AssertNotCalled(t, "ClearFiltered")
	})

	t.Run("applies multiple filter types together", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewFilterService(q)

		author := "SpamBot"
		rules := FilterRules{
			ExcludeTitle:  []string{"sponsored"},
			ExcludeAuthor: []string{"bot"},
		}
		rulesJSON, _ := json.Marshal(rules)

		sub := db.FeedSubscription{UserID: 1, FeedID: 5, FilterRules: rulesJSON}
		entries := []db.Entry{
			{ID: 10, Title: "Sponsored post", Author: nil},       // matches title
			{ID: 11, Title: "Good post", Author: &author},        // matches author
			{ID: 12, Title: "Legit post by real person", Author: nil}, // no match
		}

		q.On("MarkFiltered", mock.Anything, db.MarkFilteredParams{UserID: 1, EntryID: 10}).Return(nil)
		q.On("MarkFiltered", mock.Anything, db.MarkFilteredParams{UserID: 1, EntryID: 11}).Return(nil)
		q.On("ClearFiltered", mock.Anything, db.ClearFilteredParams{UserID: 1, EntryID: 12}).Return(nil)

		svc.ApplyFilters(context.Background(), sub, entries)

		q.AssertNumberOfCalls(t, "MarkFiltered", 2)
		q.AssertNumberOfCalls(t, "ClearFiltered", 1)
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
		assert.False(t, EvaluateFilter(entry, CompileFilterRules(&FilterRules{})))
	})

	t.Run("filters entry by title substring", func(t *testing.T) {
		entry := makeEntry("v1.0.0-alpha.1 Release", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{"alpha"}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by title regex", func(t *testing.T) {
		entry := makeEntry("v1.0.0-rc.2 Release", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{`rc\.\d+`}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by title regex alternative", func(t *testing.T) {
		entry := makeEntry("v1.0.0-beta.1 Release", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{`alpha|beta|rc`}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("does not filter when title does not match", func(t *testing.T) {
		entry := makeEntry("v1.0.0 Stable Release", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{"alpha"}})
		assert.False(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by content", func(t *testing.T) {
		content := "This is a sponsored post"
		entry := makeEntry("Title", &content, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeContent: []string{"sponsored"}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filters entry by author", func(t *testing.T) {
		author := "AutoBot"
		entry := makeEntry("Title", nil, &author)
		rules := CompileFilterRules(&FilterRules{ExcludeAuthor: []string{"bot"}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("filter is case insensitive", func(t *testing.T) {
		entry := makeEntry("ALPHA Release", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{"alpha"}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("handles nil content gracefully", func(t *testing.T) {
		entry := makeEntry("Title", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeContent: []string{"test"}})
		assert.False(t, EvaluateFilter(entry, rules))
	})

	t.Run("handles nil author gracefully", func(t *testing.T) {
		entry := makeEntry("Title", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeAuthor: []string{"test"}})
		assert.False(t, EvaluateFilter(entry, rules))
	})

	t.Run("invalid regex falls back to substring match", func(t *testing.T) {
		entry := makeEntry("Title with [brackets]", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{"[brackets]"}})
		// [brackets] is valid regex (character class), but substring also matches
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("multiple patterns in same field", func(t *testing.T) {
		entry := makeEntry("Title", nil, nil)
		rules := CompileFilterRules(&FilterRules{ExcludeTitle: []string{"nomatch", "Title"}})
		assert.True(t, EvaluateFilter(entry, rules))
	})

	t.Run("multiple fields with patterns", func(t *testing.T) {
		content := "Sponsored content"
		author := "John"
		entry := makeEntry("Title", &content, &author)
		rules := CompileFilterRules(&FilterRules{
			ExcludeTitle:   []string{"nomatch"},
			ExcludeContent: []string{"Sponsored"},
		})
		assert.True(t, EvaluateFilter(entry, rules))
	})
}

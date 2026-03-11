package service

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"

	"github.com/angristan/larafeed-go/internal/db"
)

type FilterService struct {
	q *db.Queries
}

func NewFilterService(q *db.Queries) *FilterService {
	return &FilterService{q: q}
}

type FilterRule struct {
	ExcludeTitle   *string `json:"exclude_title"`
	ExcludeContent *string `json:"exclude_content"`
	ExcludeAuthor  *string `json:"exclude_author"`
}

// EvaluateFilter checks if an entry should be filtered based on the rules.
func EvaluateFilter(entry db.Entry, rules []FilterRule) bool {
	for _, rule := range rules {
		if rule.ExcludeTitle != nil && *rule.ExcludeTitle != "" {
			if matchesPattern(*rule.ExcludeTitle, entry.Title) {
				return true
			}
		}
		if rule.ExcludeContent != nil && *rule.ExcludeContent != "" {
			content := ""
			if entry.Content != nil {
				content = *entry.Content
			}
			if matchesPattern(*rule.ExcludeContent, content) {
				return true
			}
		}
		if rule.ExcludeAuthor != nil && *rule.ExcludeAuthor != "" {
			author := ""
			if entry.Author != nil {
				author = *entry.Author
			}
			if matchesPattern(*rule.ExcludeAuthor, author) {
				return true
			}
		}
	}
	return false
}

func matchesPattern(pattern, text string) bool {
	// Try regex first
	re, err := regexp.Compile("(?i)" + pattern)
	if err == nil {
		return re.MatchString(text)
	}
	// Fall back to substring match
	return strings.Contains(strings.ToLower(text), strings.ToLower(pattern))
}

// ApplyFilters applies filter rules to entries for a subscription.
func (s *FilterService) ApplyFilters(ctx context.Context, sub db.FeedSubscription, entries []db.Entry) {
	if sub.FilterRules == nil {
		return
	}

	var rules []FilterRule
	if err := json.Unmarshal(sub.FilterRules, &rules); err != nil {
		return
	}
	if len(rules) == 0 {
		return
	}

	for _, entry := range entries {
		if EvaluateFilter(entry, rules) {
			_ = s.q.MarkFiltered(ctx, db.MarkFilteredParams{UserID: sub.UserID, EntryID: entry.ID})
		} else {
			_ = s.q.ClearFiltered(ctx, db.ClearFilteredParams{UserID: sub.UserID, EntryID: entry.ID})
		}
	}
}

// ValidateFilterPattern checks if a pattern is safe (no ReDoS).
// Patterns that are invalid regex are still accepted since the runtime
// falls back to substring matching for those.
func ValidateFilterPattern(pattern string) bool {
	if pattern == "" {
		return false
	}

	// Check for nested quantifiers (ReDoS) - various patterns:
	// Nested groups with quantifiers: (a+)+, (a*)+, (a+)*, (a*)*
	redos1 := regexp.MustCompile(`\([^)]*[+*]\)[+*]`)
	// Nested groups with quantifiers using braces: (a+){2,}
	redos2 := regexp.MustCompile(`\([^)]*[+*]\)\{`)
	// Closing brace followed by quantifier: a{2}+ (but not plain ++ which is valid in literal text like "C++")
	redos3 := regexp.MustCompile(`\}\s*[+*{]`)
	if redos1.MatchString(pattern) || redos2.MatchString(pattern) || redos3.MatchString(pattern) {
		return false
	}

	return true
}

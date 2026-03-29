package service

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
	"strings"

	"github.com/angristan/larafeed-go/internal/db"
)

type FilterService struct {
	q db.Querier
}

func NewFilterService(q db.Querier) *FilterService {
	return &FilterService{q: q}
}

// FilterRules matches the frontend format: {exclude_title: string[], exclude_content: string[], exclude_author: string[]}
type FilterRules struct {
	ExcludeTitle   []string `json:"exclude_title"`
	ExcludeContent []string `json:"exclude_content"`
	ExcludeAuthor  []string `json:"exclude_author"`
}

// compiledPattern holds either a compiled regex or a lowercase substring for fallback matching.
type compiledPattern struct {
	re        *regexp.Regexp
	substring string // non-empty when regex compilation failed
}

func (p *compiledPattern) matches(text string) bool {
	if p.re != nil {
		return p.re.MatchString(text)
	}
	return strings.Contains(strings.ToLower(text), p.substring)
}

// CompiledFilterRules holds pre-compiled patterns for efficient repeated evaluation.
type CompiledFilterRules struct {
	excludeTitle   []compiledPattern
	excludeContent []compiledPattern
	excludeAuthor  []compiledPattern
}

// CompileFilterRules compiles string patterns into regexes (or substring fallbacks) once,
// so they can be reused across many entries without recompilation.
func CompileFilterRules(rules *FilterRules) *CompiledFilterRules {
	if rules == nil {
		return nil
	}
	compile := func(patterns []string) []compiledPattern {
		var compiled []compiledPattern
		for _, p := range patterns {
			if p == "" {
				continue
			}
			re, err := regexp.Compile("(?i)" + p)
			if err != nil {
				compiled = append(compiled, compiledPattern{substring: strings.ToLower(p)})
			} else {
				compiled = append(compiled, compiledPattern{re: re})
			}
		}
		return compiled
	}
	return &CompiledFilterRules{
		excludeTitle:   compile(rules.ExcludeTitle),
		excludeContent: compile(rules.ExcludeContent),
		excludeAuthor:  compile(rules.ExcludeAuthor),
	}
}

// EvaluateFilter checks if an entry should be filtered based on the compiled rules.
func EvaluateFilter(entry db.Entry, rules *CompiledFilterRules) bool {
	if rules == nil {
		return false
	}

	for i := range rules.excludeTitle {
		if rules.excludeTitle[i].matches(entry.Title) {
			return true
		}
	}

	content := ""
	if entry.Content != nil {
		content = *entry.Content
	}
	for i := range rules.excludeContent {
		if rules.excludeContent[i].matches(content) {
			return true
		}
	}

	author := ""
	if entry.Author != nil {
		author = *entry.Author
	}
	for i := range rules.excludeAuthor {
		if rules.excludeAuthor[i].matches(author) {
			return true
		}
	}

	return false
}

// ApplyFilters applies filter rules to entries for a subscription.
func (s *FilterService) ApplyFilters(ctx context.Context, sub db.FeedSubscription, entries []db.Entry) {
	if sub.FilterRules == nil {
		return
	}

	var rules FilterRules
	if err := json.Unmarshal(sub.FilterRules, &rules); err != nil {
		return
	}
	if len(rules.ExcludeTitle) == 0 && len(rules.ExcludeContent) == 0 && len(rules.ExcludeAuthor) == 0 {
		return
	}

	compiled := CompileFilterRules(&rules)
	for _, entry := range entries {
		if EvaluateFilter(entry, compiled) {
			if err := s.q.MarkFiltered(ctx, db.MarkFilteredParams{UserID: sub.UserID, EntryID: entry.ID}); err != nil {
				slog.WarnContext(ctx, "failed to mark entry filtered", "error", err, "entry_id", entry.ID)
			}
		} else {
			if err := s.q.ClearFiltered(ctx, db.ClearFilteredParams{UserID: sub.UserID, EntryID: entry.ID}); err != nil {
				slog.WarnContext(ctx, "failed to clear entry filtered", "error", err, "entry_id", entry.ID)
			}
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

package main

import (
	"strings"
	"testing"
)

func TestSanitizeEntryContentRemovesActiveContentAndUnsafeURLs(t *testing.T) {
	t.Parallel()

	content := `<p onclick="steal()">Safe text</p>` +
		`<script>alert(1)</script><iframe src="https://attacker.test"></iframe>` +
		`<img src="https://example.test/image.png" onerror="steal()">` +
		`<a href="javascript:alert(2)" onmouseover="steal()">bad JS</a>` +
		`<a href="data:text/html,unsafe">bad data</a>`

	sanitized := sanitizeEntryContent(content)

	for _, unsafe := range []string{"<script", "alert(1)", "<iframe", "onclick", "onerror", "onmouseover", "javascript:", "data:text/html"} {
		if strings.Contains(strings.ToLower(sanitized), strings.ToLower(unsafe)) {
			t.Fatalf("sanitized content contains unsafe value %q: %s", unsafe, sanitized)
		}
	}
	if !strings.Contains(sanitized, `<img src="https://example.test/image.png"/>`) {
		t.Fatalf("safe image URL was not preserved: %s", sanitized)
	}
	if strings.Contains(sanitized, `<a`) || strings.Contains(sanitized, `target="_blank"`) {
		t.Fatalf("anchors without a safe href were not removed: %s", sanitized)
	}
	if !strings.Contains(sanitized, `bad JSbad data`) {
		t.Fatalf("unsafe links should retain their text: %s", sanitized)
	}
}

func TestSanitizeEntryContentPreservesUnicodeMarkupAndRepairsMalformedHTML(t *testing.T) {
	t.Parallel()

	content := `<h2>Résumé 東京</h2><p>L’été <strong>déjà</strong><p><em>fin`
	sanitized := sanitizeEntryContent(content)

	for _, preserved := range []string{
		`<h2>Résumé 東京</h2>`,
		`<p>L’été <strong>déjà</strong></p>`,
		`<p><em>fin</em></p>`,
	} {
		if !strings.Contains(sanitized, preserved) {
			t.Fatalf("sanitized malformed HTML did not preserve %q: %s", preserved, sanitized)
		}
	}
}

func TestSanitizeEntryContentAddsLegacySafeLinkAttributes(t *testing.T) {
	t.Parallel()

	content := `<p><a href="https://example.test/article" target="_self">external</a>` +
		`<a href="/local">local</a><a href="#section">anchor</a></p>`
	sanitized := sanitizeEntryContent(content)

	for _, link := range []string{
		`<a href="https://example.test/article" rel="nofollow noopener noreferrer" target="_blank">external</a>`,
		`<a href="/local" rel="nofollow noopener noreferrer" target="_blank">local</a>`,
		`<a href="#section" rel="nofollow noopener noreferrer" target="_blank">anchor</a>`,
	} {
		if !strings.Contains(sanitized, link) {
			t.Fatalf("sanitized content does not contain legacy-safe link %q: %s", link, sanitized)
		}
	}
}

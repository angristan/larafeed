package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSanitizeEntryContentAddsNewTabAttributesToLinks(t *testing.T) {
	content := `<p><a href="https://example.com/article">external</a><a href="/local">local</a><a href="#section">anchor</a></p>`

	sanitized := sanitizeEntryContent(content)

	assert.Contains(t, sanitized, `<a href="https://example.com/article" rel="nofollow noopener noreferrer" target="_blank">external</a>`)
	assert.Contains(t, sanitized, `<a href="/local" rel="nofollow noopener noreferrer" target="_blank">local</a>`)
	assert.Contains(t, sanitized, `<a href="#section" rel="nofollow noopener noreferrer" target="_blank">anchor</a>`)
}

func TestSanitizeEntryContentDoesNotAddNewTabAttributesWithoutHref(t *testing.T) {
	content := `<p><a>plain anchor</a><a href="javascript:alert(1)">bad</a></p>`

	sanitized := sanitizeEntryContent(content)

	assert.Contains(t, sanitized, `plain anchor`)
	assert.Contains(t, sanitized, `bad`)
	assert.NotContains(t, sanitized, `javascript:`)
	assert.NotContains(t, sanitized, `target="_blank"`)
}

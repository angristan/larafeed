package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCountReadingTimeWordsFromHTML_StripsMarkup(t *testing.T) {
	count := countReadingTimeWordsFromHTML("<p>Hello <strong>wide</strong> web</p>")

	assert.Equal(t, 3, count)
}

func TestCountReadingTimeWordsFromHTML_PreservesInlineWords(t *testing.T) {
	count := countReadingTimeWordsFromHTML("he<strong>llo</strong>")

	assert.Equal(t, 1, count)
}

func TestCountReadingTimeWordsFromHTML_SeparatesBlocks(t *testing.T) {
	count := countReadingTimeWordsFromHTML("<p>Hello</p><p>world</p>")

	assert.Equal(t, 2, count)
}

func TestReadingTimeTextFromHTML_RoundsAt300WordsPerMinute(t *testing.T) {
	shortContent := strings.Repeat("word ", 149)
	oneMinuteContent := strings.Repeat("word ", 150)

	assert.Equal(t, "less than a minute read", ReadingTimeTextFromHTML(shortContent))
	assert.Equal(t, "1 min read", ReadingTimeTextFromHTML(oneMinuteContent))
}

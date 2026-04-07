package service

import (
	"fmt"
	htmlstd "html"
	"math"
	"regexp"
	"strings"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

const readerWordsPerMinute = 300

var readingTimeTokenPattern = regexp.MustCompile(`\p{Han}|\p{Hiragana}|\p{Katakana}|[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*`)

var readingTimeSeparatorTags = map[atom.Atom]struct{}{
	atom.Article:    {},
	atom.Blockquote: {},
	atom.Br:         {},
	atom.Div:        {},
	atom.Figcaption: {},
	atom.Figure:     {},
	atom.Footer:     {},
	atom.H1:         {},
	atom.H2:         {},
	atom.H3:         {},
	atom.H4:         {},
	atom.H5:         {},
	atom.H6:         {},
	atom.Header:     {},
	atom.Hr:         {},
	atom.Li:         {},
	atom.Nav:        {},
	atom.Ol:         {},
	atom.P:          {},
	atom.Pre:        {},
	atom.Section:    {},
	atom.Table:      {},
	atom.Tbody:      {},
	atom.Td:         {},
	atom.Tfoot:      {},
	atom.Th:         {},
	atom.Thead:      {},
	atom.Tr:         {},
	atom.Ul:         {},
}

// ReadingTimeTextFromHTML returns the reader-facing reading-time label for an
// entry's HTML content, preserving the existing 300 WPM behavior.
func ReadingTimeTextFromHTML(content string) string {
	words := countReadingTimeWordsFromHTML(content)
	minutes := int(math.Round(float64(words) / readerWordsPerMinute))
	if minutes < 1 {
		return "less than a minute read"
	}

	return fmt.Sprintf("%d min read", minutes)
}

func countReadingTimeWordsFromHTML(content string) int {
	text := extractReadingTimeText(content)
	return len(readingTimeTokenPattern.FindAllString(text, -1))
}

func extractReadingTimeText(content string) string {
	if content == "" {
		return ""
	}

	nodes, err := html.ParseFragment(strings.NewReader(content), &html.Node{
		Type:     html.ElementNode,
		DataAtom: atom.Body,
		Data:     "body",
	})
	if err != nil {
		return strings.Join(strings.Fields(htmlstd.UnescapeString(content)), " ")
	}

	var builder strings.Builder
	for _, node := range nodes {
		appendReadingTimeText(&builder, node)
	}

	return strings.Join(strings.Fields(htmlstd.UnescapeString(builder.String())), " ")
}

func appendReadingTimeText(builder *strings.Builder, node *html.Node) {
	switch node.Type {
	case html.ElementNode:
		if node.DataAtom == atom.Script || node.DataAtom == atom.Style {
			return
		}
		if isReadingTimeSeparator(node.DataAtom) {
			builder.WriteByte(' ')
		}
	case html.TextNode:
		builder.WriteString(node.Data)
	}

	for child := node.FirstChild; child != nil; child = child.NextSibling {
		appendReadingTimeText(builder, child)
	}

	if node.Type == html.ElementNode && isReadingTimeSeparator(node.DataAtom) {
		builder.WriteByte(' ')
	}
}

func isReadingTimeSeparator(tag atom.Atom) bool {
	_, ok := readingTimeSeparatorTags[tag]
	return ok
}

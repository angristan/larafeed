package service

import (
	"encoding/xml"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseOPML(t *testing.T) {
	t.Run("parses valid OPML with categories", func(t *testing.T) {
		opmlXML := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test Export</title></head>
  <body>
    <outline text="Tech">
      <outline text="Hacker News" title="Hacker News" type="rss" xmlUrl="https://news.ycombinator.com/rss" htmlUrl="https://news.ycombinator.com"/>
      <outline text="Lobsters" title="Lobsters" type="rss" xmlUrl="https://lobste.rs/rss" htmlUrl="https://lobste.rs"/>
    </outline>
    <outline text="News">
      <outline text="BBC" title="BBC" type="rss" xmlUrl="https://feeds.bbci.co.uk/news/rss.xml" htmlUrl="https://www.bbc.co.uk/news"/>
    </outline>
  </body>
</opml>`

		var opml OPML
		err := xml.Unmarshal([]byte(opmlXML), &opml)
		require.NoError(t, err)

		assert.Equal(t, "2.0", opml.Version)
		assert.Equal(t, "Test Export", opml.Head.Title)
		assert.Len(t, opml.Body.Outlines, 2)

		// Tech category
		tech := opml.Body.Outlines[0]
		assert.Equal(t, "Tech", tech.Text)
		assert.Len(t, tech.Outlines, 2)
		assert.Equal(t, "Hacker News", tech.Outlines[0].Text)
		assert.Equal(t, "https://news.ycombinator.com/rss", tech.Outlines[0].XMLURL)
		assert.Equal(t, "https://news.ycombinator.com", tech.Outlines[0].HTMLURL)
		assert.Equal(t, "rss", tech.Outlines[0].Type)

		// News category
		news := opml.Body.Outlines[1]
		assert.Equal(t, "News", news.Text)
		assert.Len(t, news.Outlines, 1)
		assert.Equal(t, "https://feeds.bbci.co.uk/news/rss.xml", news.Outlines[0].XMLURL)
	})

	t.Run("parses flat OPML without categories", func(t *testing.T) {
		opmlXML := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Flat Export</title></head>
  <body>
    <outline text="My Feed" type="rss" xmlUrl="https://example.com/feed" htmlUrl="https://example.com"/>
  </body>
</opml>`

		var opml OPML
		err := xml.Unmarshal([]byte(opmlXML), &opml)
		require.NoError(t, err)

		assert.Len(t, opml.Body.Outlines, 1)
		assert.Equal(t, "My Feed", opml.Body.Outlines[0].Text)
		assert.Equal(t, "https://example.com/feed", opml.Body.Outlines[0].XMLURL)
		assert.Empty(t, opml.Body.Outlines[0].Outlines)
	})

	t.Run("parses custom title attribute", func(t *testing.T) {
		opmlXML := `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Cat">
      <outline text="Original" customTitle="Custom Name" type="rss" xmlUrl="https://example.com/feed"/>
    </outline>
  </body>
</opml>`

		var opml OPML
		err := xml.Unmarshal([]byte(opmlXML), &opml)
		require.NoError(t, err)

		assert.Equal(t, "Custom Name", opml.Body.Outlines[0].Outlines[0].CustomTitle)
	})

	t.Run("rejects invalid XML", func(t *testing.T) {
		var opml OPML
		err := xml.Unmarshal([]byte("not xml at all"), &opml)
		assert.Error(t, err)
	})

	t.Run("handles empty body", func(t *testing.T) {
		opmlXML := `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Empty</title></head>
  <body></body>
</opml>`

		var opml OPML
		err := xml.Unmarshal([]byte(opmlXML), &opml)
		require.NoError(t, err)
		assert.Empty(t, opml.Body.Outlines)
	})
}

func TestOPMLExportFormat(t *testing.T) {
	opml := OPML{
		Version: "2.0",
		Head:    OPMLHead{Title: "Larafeed Export"},
		Body: OPMLBody{
			Outlines: []OPMLOutline{
				{
					Text: "Tech",
					Outlines: []OPMLOutline{
						{
							Text:    "Example Feed",
							Title:   "Example Feed",
							Type:    "rss",
							XMLURL:  "https://example.com/feed.xml",
							HTMLURL: "https://example.com",
						},
					},
				},
			},
		},
	}

	data, err := xml.MarshalIndent(opml, "", "  ")
	require.NoError(t, err)

	output := xml.Header + string(data)
	assert.Contains(t, output, `version="2.0"`)
	assert.Contains(t, output, `<title>Larafeed Export</title>`)
	assert.Contains(t, output, `text="Tech"`)
	assert.Contains(t, output, `xmlUrl="https://example.com/feed.xml"`)
	assert.Contains(t, output, `htmlUrl="https://example.com"`)
	assert.True(t, strings.HasPrefix(output, `<?xml version="1.0" encoding="UTF-8"?>`))
}

package service

import (
	"context"
	"encoding/xml"
	"strings"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
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

func TestOPMLExport(t *testing.T) {
	t.Run("exports subscriptions grouped by category", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewOPMLService(q, nil)

		customName := "My HN"
		q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).Return([]db.ListSubscriptionsForUserRow{
			{
				ID: 10, Name: "Hacker News", FeedURL: "https://news.ycombinator.com/rss",
				SiteURL: "https://news.ycombinator.com", CategoryName: "Tech",
				CustomFeedName: &customName,
			},
			{
				ID: 11, Name: "Lobsters", FeedURL: "https://lobste.rs/rss",
				SiteURL: "https://lobste.rs", CategoryName: "Tech",
			},
			{
				ID: 12, Name: "BBC News", FeedURL: "https://feeds.bbci.co.uk/news/rss.xml",
				SiteURL: "https://www.bbc.co.uk/news", CategoryName: "News",
			},
		}, nil)

		data, err := svc.Export(context.Background(), 1)
		require.NoError(t, err)

		output := string(data)
		assert.Contains(t, output, `<?xml version="1.0" encoding="UTF-8"?>`)
		assert.Contains(t, output, `version="2.0"`)

		// Parse back to verify structure
		var opml OPML
		// Strip XML header for unmarshal
		xmlBody := output[strings.Index(output, "<opml"):]
		require.NoError(t, xml.Unmarshal([]byte(xmlBody), &opml))

		assert.Equal(t, "Larafeed Export", opml.Head.Title)
		assert.Len(t, opml.Body.Outlines, 2)

		// Find Tech and News categories (map order is non-deterministic)
		catMap := make(map[string]OPMLOutline)
		for _, o := range opml.Body.Outlines {
			catMap[o.Text] = o
		}

		tech := catMap["Tech"]
		assert.Len(t, tech.Outlines, 2)
		assert.Equal(t, "My HN", tech.Outlines[0].CustomTitle)
		assert.Equal(t, "https://news.ycombinator.com/rss", tech.Outlines[0].XMLURL)

		news := catMap["News"]
		assert.Len(t, news.Outlines, 1)
		assert.Equal(t, "https://feeds.bbci.co.uk/news/rss.xml", news.Outlines[0].XMLURL)
	})

	t.Run("exports empty OPML when no subscriptions", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewOPMLService(q, nil)

		q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
			Return([]db.ListSubscriptionsForUserRow{}, nil)

		data, err := svc.Export(context.Background(), 1)
		require.NoError(t, err)

		var opml OPML
		xmlBody := string(data)[strings.Index(string(data), "<opml"):]
		require.NoError(t, xml.Unmarshal([]byte(xmlBody), &opml))

		assert.Empty(t, opml.Body.Outlines)
	})

	t.Run("returns error when DB query fails", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewOPMLService(q, nil)

		q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).
			Return([]db.ListSubscriptionsForUserRow(nil), assert.AnError)

		_, err := svc.Export(context.Background(), 1)
		assert.Error(t, err)
	})

	t.Run("omits customTitle when not set", func(t *testing.T) {
		q := mocks.NewQuerier(t)
		svc := NewOPMLService(q, nil)

		q.On("ListSubscriptionsForUser", mock.Anything, int64(1)).Return([]db.ListSubscriptionsForUserRow{
			{
				ID: 10, Name: "Go Blog", FeedURL: "https://go.dev/blog/feed.atom",
				SiteURL: "https://go.dev/blog", CategoryName: "Dev",
			},
		}, nil)

		data, err := svc.Export(context.Background(), 1)
		require.NoError(t, err)

		output := string(data)
		assert.NotContains(t, output, "customTitle")
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

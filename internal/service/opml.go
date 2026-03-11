package service

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
)

type OPMLService struct {
	q           *db.Queries
	feedService *FeedService
}

func NewOPMLService(q *db.Queries, feedService *FeedService) *OPMLService {
	return &OPMLService{
		q:           q,
		feedService: feedService,
	}
}

// OPML XML structures
type OPML struct {
	XMLName xml.Name  `xml:"opml"`
	Version string    `xml:"version,attr"`
	Head    OPMLHead  `xml:"head"`
	Body    OPMLBody  `xml:"body"`
}

type OPMLHead struct {
	Title       string `xml:"title"`
	DateCreated string `xml:"dateCreated,omitempty"`
}

type OPMLBody struct {
	Outlines []OPMLOutline `xml:"outline"`
}

type OPMLOutline struct {
	Text        string        `xml:"text,attr"`
	Title       string        `xml:"title,attr,omitempty"`
	CustomTitle string        `xml:"customTitle,attr,omitempty"`
	Type        string        `xml:"type,attr,omitempty"`
	XMLURL      string        `xml:"xmlUrl,attr,omitempty"`
	HTMLURL     string        `xml:"htmlUrl,attr,omitempty"`
	Outlines    []OPMLOutline `xml:"outline,omitempty"`
}

// Export generates an OPML document for a user's subscriptions.
func (s *OPMLService) Export(ctx context.Context, userID int64) ([]byte, error) {
	feeds, err := s.q.ListSubscriptionsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}

	// Group feeds by category
	grouped := make(map[string][]db.UserFeed)
	for _, f := range feeds {
		grouped[f.CategoryName] = append(grouped[f.CategoryName], f)
	}

	var outlines []OPMLOutline
	for catName, catFeeds := range grouped {
		var children []OPMLOutline
		for _, f := range catFeeds {
			title := f.Name
			customTitle := ""
			if f.CustomFeedName != nil {
				customTitle = *f.CustomFeedName
			}
			children = append(children, OPMLOutline{
				Text:        title,
				Title:       title,
				CustomTitle: customTitle,
				Type:        "rss",
				XMLURL:      f.FeedURL,
				HTMLURL:     f.SiteURL,
			})
		}
		outlines = append(outlines, OPMLOutline{
			Text:     catName,
			Outlines: children,
		})
	}

	opml := OPML{
		Version: "2.0",
		Head: OPMLHead{
			Title:       "Larafeed Export",
			DateCreated: time.Now().Format(time.RFC1123Z),
		},
		Body: OPMLBody{Outlines: outlines},
	}

	data, err := xml.MarshalIndent(opml, "", "  ")
	if err != nil {
		return nil, err
	}
	return append([]byte(xml.Header), data...), nil
}

// Import parses an OPML file and creates subscriptions.
func (s *OPMLService) Import(ctx context.Context, userID int64, reader io.Reader) error {
	data, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("read OPML: %w", err)
	}

	var opml OPML
	if err := xml.Unmarshal(data, &opml); err != nil {
		return fmt.Errorf("parse OPML: %w", err)
	}

	for _, outline := range opml.Body.Outlines {
		if outline.XMLURL != "" {
			// Validate URL before importing (SSRF protection)
			if err := ValidateURL(outline.XMLURL); err != nil {
				continue
			}
			// Single feed, no category wrapper
			cat, err := s.q.FindOrCreateCategory(ctx, db.FindOrCreateCategoryParams{UserID: userID, Name: "Uncategorized"})
			if err != nil {
				continue
			}
			_, _ = s.feedService.CreateFeed(ctx, userID, outline.XMLURL, cat.ID, outline.Text)
			continue
		}

		// Category with child feeds
		catName := outline.Text
		if catName == "" {
			catName = "Uncategorized"
		}
		cat, err := s.q.FindOrCreateCategory(ctx, db.FindOrCreateCategoryParams{UserID: userID, Name: catName})
		if err != nil {
			continue
		}

		for _, child := range outline.Outlines {
			if child.XMLURL == "" {
				continue
			}
			// Validate URL before importing (SSRF protection)
			if err := ValidateURL(child.XMLURL); err != nil {
				continue
			}
			_, _ = s.feedService.CreateFeed(ctx, userID, child.XMLURL, cat.ID, child.Text)
		}
	}

	return nil
}

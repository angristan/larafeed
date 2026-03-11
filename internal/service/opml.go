package service

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
)

// OPMLFeedImport represents a single feed to import from OPML.
type OPMLFeedImport struct {
	FeedURL      string
	CategoryName string
	FallbackName string
}

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
	XMLName xml.Name `xml:"opml"`
	Version string   `xml:"version,attr"`
	Head    OPMLHead `xml:"head"`
	Body    OPMLBody `xml:"body"`
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

// ParseOPML parses an OPML file and returns the list of feeds to import.
func (s *OPMLService) ParseOPML(ctx context.Context, userID int64, reader io.Reader) ([]OPMLFeedImport, error) {
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read OPML: %w", err)
	}

	var opml OPML
	if err := xml.Unmarshal(data, &opml); err != nil {
		return nil, fmt.Errorf("parse OPML: %w", err)
	}

	var imports []OPMLFeedImport

	for _, outline := range opml.Body.Outlines {
		if outline.XMLURL != "" {
			if err := ValidateURL(outline.XMLURL); err != nil {
				continue
			}
			imports = append(imports, OPMLFeedImport{
				FeedURL:      outline.XMLURL,
				CategoryName: "Uncategorized",
				FallbackName: outline.Text,
			})
			continue
		}

		catName := outline.Text
		if catName == "" {
			catName = "Uncategorized"
		}

		for _, child := range outline.Outlines {
			if child.XMLURL == "" {
				continue
			}
			if err := ValidateURL(child.XMLURL); err != nil {
				continue
			}
			imports = append(imports, OPMLFeedImport{
				FeedURL:      child.XMLURL,
				CategoryName: catName,
				FallbackName: child.Text,
			})
		}
	}

	return imports, nil
}

// Import parses an OPML file and creates subscriptions synchronously.
// Kept for backward compatibility; prefer ParseOPML + async job dispatch.
func (s *OPMLService) Import(ctx context.Context, userID int64, reader io.Reader) error {
	imports, err := s.ParseOPML(ctx, userID, reader)
	if err != nil {
		return err
	}

	for _, imp := range imports {
		cat, err := s.q.FindOrCreateCategory(ctx, db.FindOrCreateCategoryParams{UserID: userID, Name: imp.CategoryName})
		if err != nil {
			continue
		}
		_, _ = s.feedService.CreateFeed(ctx, userID, imp.FeedURL, cat.ID, imp.FallbackName)
	}

	return nil
}

package service

import (
	"context"

	"github.com/angristan/larafeed-go/internal/db"
)

type EntryService struct {
	q db.Querier
}

func NewEntryService(q db.Querier) *EntryService {
	return &EntryService{q: q}
}

// UpdateInteractions updates read, starred, and archived states for an entry.
func (s *EntryService) UpdateInteractions(ctx context.Context, userID, entryID int64, read, starred, archived *bool) error {
	if read != nil {
		if *read {
			if err := s.q.MarkAsRead(ctx, db.MarkAsReadParams{UserID: userID, EntryID: entryID}); err != nil {
				return err
			}
		} else {
			if err := s.q.MarkAsUnread(ctx, db.MarkAsUnreadParams{UserID: userID, EntryID: entryID}); err != nil {
				return err
			}
		}
	}

	if starred != nil {
		if *starred {
			if err := s.q.Favorite(ctx, db.FavoriteParams{UserID: userID, EntryID: entryID}); err != nil {
				return err
			}
		} else {
			if err := s.q.Unfavorite(ctx, db.UnfavoriteParams{UserID: userID, EntryID: entryID}); err != nil {
				return err
			}
		}
	}

	if archived != nil {
		if *archived {
			if err := s.q.Archive(ctx, db.ArchiveParams{UserID: userID, EntryID: entryID}); err != nil {
				return err
			}
		} else {
			if err := s.q.Unarchive(ctx, db.UnarchiveParams{UserID: userID, EntryID: entryID}); err != nil {
				return err
			}
		}
	}

	return nil
}

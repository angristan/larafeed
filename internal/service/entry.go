package service

import (
	"context"

	"github.com/angristan/larafeed-go/internal/apperr"
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
	if read == nil && starred == nil && archived == nil {
		return nil
	}

	if read != nil {
		if *read {
			rows, err := s.q.MarkAsRead(ctx, db.MarkAsReadParams{UserID: userID, EntryID: entryID})
			writeErr := interactionWriteErr(rows, err)
			if writeErr != nil {
				return writeErr
			}
		} else {
			rows, err := s.q.MarkAsUnread(ctx, db.MarkAsUnreadParams{UserID: userID, EntryID: entryID})
			writeErr := interactionWriteErr(rows, err)
			if writeErr != nil {
				return writeErr
			}
		}
	}

	if starred != nil {
		if *starred {
			rows, err := s.q.Favorite(ctx, db.FavoriteParams{UserID: userID, EntryID: entryID})
			writeErr := interactionWriteErr(rows, err)
			if writeErr != nil {
				return writeErr
			}
		} else {
			rows, err := s.q.Unfavorite(ctx, db.UnfavoriteParams{UserID: userID, EntryID: entryID})
			writeErr := interactionWriteErr(rows, err)
			if writeErr != nil {
				return writeErr
			}
		}
	}

	if archived != nil {
		if *archived {
			rows, err := s.q.Archive(ctx, db.ArchiveParams{UserID: userID, EntryID: entryID})
			writeErr := interactionWriteErr(rows, err)
			if writeErr != nil {
				return writeErr
			}
		} else {
			rows, err := s.q.Unarchive(ctx, db.UnarchiveParams{UserID: userID, EntryID: entryID})
			writeErr := interactionWriteErr(rows, err)
			if writeErr != nil {
				return writeErr
			}
		}
	}

	return nil
}

func interactionWriteErr(rowsAffected int64, err error) error {
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return apperr.NewNotFound("entry")
	}
	return nil
}

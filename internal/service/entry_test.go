package service

import (
	"context"
	"testing"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestUpdateInteractions_MarkAsRead(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("MarkAsRead", mock.Anything, db.MarkAsReadParams{UserID: 1, EntryID: 42}).Return(nil)
	svc := NewEntryService(q)

	read := true
	err := svc.UpdateInteractions(context.Background(), 1, 42, &read, nil, nil)
	require.NoError(t, err)
}

func TestUpdateInteractions_MarkAsUnread(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("MarkAsUnread", mock.Anything, db.MarkAsUnreadParams{UserID: 1, EntryID: 42}).Return(nil)
	svc := NewEntryService(q)

	read := false
	err := svc.UpdateInteractions(context.Background(), 1, 42, &read, nil, nil)
	require.NoError(t, err)
}

func TestUpdateInteractions_Favorite(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("Favorite", mock.Anything, db.FavoriteParams{UserID: 1, EntryID: 42}).Return(nil)
	svc := NewEntryService(q)

	starred := true
	err := svc.UpdateInteractions(context.Background(), 1, 42, nil, &starred, nil)
	require.NoError(t, err)
}

func TestUpdateInteractions_Archive(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("Archive", mock.Anything, db.ArchiveParams{UserID: 1, EntryID: 42}).Return(nil)
	svc := NewEntryService(q)

	archived := true
	err := svc.UpdateInteractions(context.Background(), 1, 42, nil, nil, &archived)
	require.NoError(t, err)
}

func TestUpdateInteractions_AllNil(t *testing.T) {
	q := mocks.NewQuerier(t)
	svc := NewEntryService(q)

	err := svc.UpdateInteractions(context.Background(), 1, 42, nil, nil, nil)
	require.NoError(t, err)
	// No DB methods should have been called
	q.AssertNotCalled(t, "MarkAsRead", mock.Anything, mock.Anything)
}

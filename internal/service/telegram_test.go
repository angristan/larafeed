package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTelegramService_Enabled(t *testing.T) {
	t.Run("enabled when both token and chatID are set", func(t *testing.T) {
		svc := NewTelegramService("token", "chatid")
		assert.True(t, svc.Enabled())
	})

	t.Run("disabled when token is empty", func(t *testing.T) {
		svc := NewTelegramService("", "chatid")
		assert.False(t, svc.Enabled())
	})

	t.Run("disabled when chatID is empty", func(t *testing.T) {
		svc := NewTelegramService("token", "")
		assert.False(t, svc.Enabled())
	})

	t.Run("disabled when both are empty", func(t *testing.T) {
		svc := NewTelegramService("", "")
		assert.False(t, svc.Enabled())
	})
}

func TestTelegramService_SendMessage_WhenDisabled(t *testing.T) {
	svc := NewTelegramService("", "")
	err := svc.SendMessage("test message")
	assert.NoError(t, err)
}

func TestTelegramService_NotifyRegistration_WhenDisabled(t *testing.T) {
	svc := NewTelegramService("", "")
	// Should not panic or make HTTP calls when disabled
	svc.NotifyRegistration("John Doe", "john@example.com")
}

func TestTelegramService_NotifyLoginFailure_WhenDisabled(t *testing.T) {
	svc := NewTelegramService("", "")
	// Should not panic or make HTTP calls when disabled
	svc.NotifyLoginFailure("john@example.com", "1.2.3.4")
}

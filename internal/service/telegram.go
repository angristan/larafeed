package service

import (
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
)

type TelegramService struct {
	token  string
	chatID string
}

func NewTelegramService(token, chatID string) *TelegramService {
	return &TelegramService{token: token, chatID: chatID}
}

func (s *TelegramService) Enabled() bool {
	return s.token != "" && s.chatID != ""
}

// SendMessage sends a message to the configured Telegram chat.
func (s *TelegramService) SendMessage(text string) error {
	if !s.Enabled() {
		return nil
	}

	apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", s.token)
	resp, err := http.PostForm(apiURL, url.Values{
		"chat_id": {s.chatID},
		"text":    {text},
	})
	if err != nil {
		return err
	}
	err = resp.Body.Close()
	if err != nil {
		return err
	}
	return nil
}

// NotifyRegistration sends a notification about a new user registration.
func (s *TelegramService) NotifyRegistration(name, email string) {
	err := s.SendMessage(fmt.Sprintf("🆕 New user registered: %s (%s)", name, email))
	if err != nil {
		slog.Error("failed to send Telegram registration notification", "email", email, "error", err)
	}
}

// NotifyLoginFailure sends a notification about a failed login attempt.
func (s *TelegramService) NotifyLoginFailure(email, ip string) {
	err := s.SendMessage(fmt.Sprintf("⚠️ Failed login attempt: %s from %s", email, ip))
	if err != nil {
		slog.Error("failed to send Telegram login failure notification", "email", email, "error", err)
	}
}

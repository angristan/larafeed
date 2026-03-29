package config

import (
	"fmt"
	"os"
)

type Config struct {
	AppName     string
	AppURL      string
	AppEnv      string
	Port        string
	ViteDev     string
	DatabaseURL string
	SessionKey  string

	// Services
	ImgProxyURL  string
	ImgProxyKey  string
	ImgProxySalt string
	GeminiAPIKey string
	TelegramToken  string
	TelegramChatID string

	// Feature flags
	RegistrationEnabled bool

	// Mail
	SMTPHost string
	SMTPPort string
	SMTPUser string
	SMTPPass string
	MailFrom string
}

func Load() *Config {
	return &Config{
		AppName:     getEnv("APP_NAME", "Larafeed"),
		AppURL:      getEnv("APP_URL", "http://localhost:3000"),
		AppEnv:      getEnv("APP_ENV", "development"),
		Port:        getEnv("PORT", "3000"),
		ViteDev:     getEnv("VITE_DEV_URL", "http://localhost:5173"),
		DatabaseURL: getEnv("DATABASE_URL", "postgres://localhost:5432/larafeed?sslmode=disable"),
		SessionKey:  getEnv("SESSION_SECRET", "change-me-to-a-32-byte-secret!!"),

		ImgProxyURL:  getEnv("IMGPROXY_URL", ""),
		ImgProxyKey:  getEnv("IMGPROXY_KEY", ""),
		ImgProxySalt: getEnv("IMGPROXY_SALT", ""),
		GeminiAPIKey: getEnv("GEMINI_API_KEY", ""),
		TelegramToken:  getEnv("TELEGRAM_BOT_TOKEN", ""),
		TelegramChatID: getEnv("TELEGRAM_CHAT_ID", ""),

		RegistrationEnabled: getEnv("REGISTRATION_ENABLED", "true") == "true",

		SMTPHost: getEnv("SMTP_HOST", ""),
		SMTPPort: getEnv("SMTP_PORT", "587"),
		SMTPUser: getEnv("SMTP_USER", ""),
		SMTPPass: getEnv("SMTP_PASS", ""),
		MailFrom: getEnv("MAIL_FROM", "hello@example.com"),
	}
}

func (c *Config) IsDev() bool {
	return c.AppEnv == "development" || c.AppEnv == "local"
}

// Validate checks that critical configuration is set for non-dev environments.
// In development mode, defaults are acceptable.
func (c *Config) Validate() error {
	if c.IsDev() {
		return nil
	}

	if c.SessionKey == "change-me-to-a-32-byte-secret!!" {
		return fmt.Errorf("SESSION_SECRET must be changed from the default value in %s environment", c.AppEnv)
	}

	if c.DatabaseURL == "" {
		return fmt.Errorf("DATABASE_URL is required in %s environment", c.AppEnv)
	}

	return nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

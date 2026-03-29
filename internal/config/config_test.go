package config

import "testing"

func TestValidate_DevEnvironment_AllowsDefaults(t *testing.T) {
	cfg := &Config{
		AppEnv:     "development",
		SessionKey: "change-me-to-a-32-byte-secret!!",
	}
	err := cfg.Validate()
	if err != nil {
		t.Errorf("expected no error in dev, got: %v", err)
	}
}

func TestValidate_Production_RejectsDefaultSessionSecret(t *testing.T) {
	cfg := &Config{
		AppEnv:      "production",
		SessionKey:  "change-me-to-a-32-byte-secret!!",
		DatabaseURL: "postgres://localhost/db",
	}
	err := cfg.Validate()
	if err == nil {
		t.Error("expected error for default SESSION_SECRET in production")
	}
}

func TestValidate_Production_RejectsEmptyDatabaseURL(t *testing.T) {
	cfg := &Config{
		AppEnv:      "production",
		SessionKey:  "a-real-32-byte-secret-value!!!!",
		DatabaseURL: "",
	}
	err := cfg.Validate()
	if err == nil {
		t.Error("expected error for empty DATABASE_URL in production")
	}
}

func TestValidate_Production_AcceptsValidConfig(t *testing.T) {
	cfg := &Config{
		AppEnv:      "production",
		SessionKey:  "a-real-32-byte-secret-value!!!!",
		DatabaseURL: "postgres://localhost/db",
	}
	err := cfg.Validate()
	if err != nil {
		t.Errorf("expected no error for valid production config, got: %v", err)
	}
}

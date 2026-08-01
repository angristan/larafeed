//nolint:noinlineerr // Scoped test assertions keep failure values local.
package main

import (
	"context"
	"strings"
	"testing"
)

func TestExportCLIRequiresOutputDirectoryAndDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if err := run([]string{"export"}); err == nil || !strings.Contains(err.Error(), "--output-dir") {
		t.Fatalf("missing output error = %v", err)
	}
	if err := run([]string{"export", "--output-dir", t.TempDir()}); err == nil || !strings.Contains(err.Error(), "DATABASE_URL") {
		t.Fatalf("missing DATABASE_URL error = %v", err)
	}
}

func TestExportCLIRequiresExplicitAdministrator(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://unused")
	err := run([]string{"export", "--output-dir", t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "--admin-user-id") {
		t.Fatalf("missing administrator error = %v", err)
	}
}

func TestConnectionErrorsDoNotPrintCredentials(t *testing.T) {
	secret := "migration-secret-value"
	err := exportPostgres(context.Background(), "postgres://operator:"+secret+"@%", t.TempDir(), 10, true, nil)
	if err == nil {
		t.Fatal("invalid DATABASE_URL unexpectedly connected")
	}
	if strings.Contains(err.Error(), secret) {
		t.Fatalf("connection error leaked DATABASE_URL password: %v", err)
	}
}

func TestRenderCLIRequiresSeparateExplicitDirectories(t *testing.T) {
	if err := run([]string{"render", "--output-dir", t.TempDir()}); err == nil || !strings.Contains(err.Error(), "--sql-dir") {
		t.Fatalf("missing SQL output error = %v", err)
	}
}

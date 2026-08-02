//nolint:noinlineerr // Scoped test assertions keep failure values local.
package main

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestArtifactDeterministicChunkBoundariesAndRendering(t *testing.T) {
	t.Parallel()
	first := filepath.Join(t.TempDir(), "artifact")
	second := filepath.Join(t.TempDir(), "artifact")
	writeUserArtifact(t, first, 2, 5, false)
	writeUserArtifact(t, second, 2, 5, false)

	firstFiles := readDirectoryFiles(t, first)
	secondFiles := readDirectoryFiles(t, second)
	if !reflect.DeepEqual(firstFiles, secondFiles) {
		t.Fatal("identical rows produced different artifacts")
	}
	manifest, err := validateArtifact(first)
	if err != nil {
		t.Fatal(err)
	}
	users := manifest.Tables[0]
	if users.OutputCount != 5 || len(users.Chunks) != 3 {
		t.Fatalf("users stats = %#v", users)
	}
	gotRows := []int{users.Chunks[0].Rows, users.Chunks[1].Rows, users.Chunks[2].Rows}
	if !reflect.DeepEqual(gotRows, []int{2, 2, 1}) {
		t.Fatalf("chunk rows = %v", gotRows)
	}

	sqlDir := filepath.Join(t.TempDir(), "sql")
	if err := renderSQL(first, sqlDir); err != nil {
		t.Fatal(err)
	}
	chunkSQL, err := os.ReadFile(filepath.Join(sqlDir, "01-users-000001.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sql := string(chunkSQL)
	if !strings.Contains(sql, "O''Reader — 你好") || !strings.Contains(sql, "X'") || !strings.Contains(sql, "ON CONFLICT DO NOTHING") {
		t.Fatalf("rendered SQL does not preserve escaping/BLOB/idempotence:\n%s", sql)
	}
	cleanSQL, err := os.ReadFile(filepath.Join(sqlDir, "0000-clean-target.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Index(string(cleanSQL), "DELETE FROM entry_summaries") > strings.Index(string(cleanSQL), "DELETE FROM users") {
		t.Fatal("clean target is not in reverse foreign-key order")
	}
}

func TestRenderedSQLAppliesToTargetSchema(t *testing.T) {
	sqlite, err := exec.LookPath("sqlite3")
	if err != nil {
		t.Skip("sqlite3 is not installed")
	}
	artifactDir := filepath.Join(t.TempDir(), "artifact")
	sqlDir := filepath.Join(t.TempDir(), "sql")
	writeUserArtifact(t, artifactDir, 2, 3, false)
	if err := renderSQL(artifactDir, sqlDir); err != nil {
		t.Fatal(err)
	}
	manifest, err := validateArtifact(artifactDir)
	if err != nil {
		t.Fatal(err)
	}
	database := filepath.Join(t.TempDir(), "target.sqlite3")
	files := []string{
		filepath.Join("..", "..", "migrations", "0001_initial.sql"),
		filepath.Join("..", "..", "migrations", "0002_reader_indexes.sql"),
		filepath.Join("..", "..", "migrations", "0003_compatibility_tokens.sql"),
		filepath.Join("..", "..", "migrations", "0004_chart_daily_activity.sql"),
		filepath.Join(sqlDir, "0000-clean-target.sql"),
	}
	for _, table := range manifest.Tables {
		for _, chunk := range table.Chunks {
			files = append(files, filepath.Join(sqlDir, strings.TrimSuffix(chunk.File, ".jsonl")+".sql"))
		}
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		command := exec.Command(sqlite, database)
		command.Stdin = bytes.NewReader(data)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("apply %s: %v\n%s", filepath.Base(file), err, output)
		}
	}
	output, err := exec.Command(sqlite, database, "PRAGMA foreign_key_check; SELECT COUNT(*) FROM users;").CombinedOutput()
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(output)) != "3" {
		t.Fatalf("foreign-key/count output = %q, want 3", output)
	}
}

func TestRepresentativeRenderedSQLAppliesAllTables(t *testing.T) {
	sqlite, err := exec.LookPath("sqlite3")
	if err != nil {
		t.Skip("sqlite3 is not installed")
	}
	artifactDir := filepath.Join(t.TempDir(), "artifact")
	sqlDir := filepath.Join(t.TempDir(), "sql")
	writeRepresentativeArtifact(t, artifactDir)
	if err := renderSQL(artifactDir, sqlDir); err != nil {
		t.Fatal(err)
	}
	manifest, err := validateArtifact(artifactDir)
	if err != nil {
		t.Fatal(err)
	}
	database := filepath.Join(t.TempDir(), "target.sqlite3")
	files := []string{
		filepath.Join("..", "..", "migrations", "0001_initial.sql"),
		filepath.Join("..", "..", "migrations", "0002_reader_indexes.sql"),
		filepath.Join("..", "..", "migrations", "0003_compatibility_tokens.sql"),
		filepath.Join("..", "..", "migrations", "0004_chart_daily_activity.sql"),
		filepath.Join(sqlDir, "0000-clean-target.sql"),
	}
	for _, table := range manifest.Tables {
		for _, chunk := range table.Chunks {
			files = append(files, filepath.Join(sqlDir, strings.TrimSuffix(chunk.File, ".jsonl")+".sql"))
		}
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		command := exec.Command(sqlite, database)
		command.Stdin = bytes.NewReader(data)
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("apply %s: %v\n%s", filepath.Base(file), err, output)
		}
	}
	output, err := exec.Command(sqlite, database, `
PRAGMA foreign_key_check;
SELECT group_concat(name || ':' || count_value, ',')
FROM (
  SELECT 'users' AS name, COUNT(*) AS count_value FROM users
  UNION ALL SELECT 'feeds', COUNT(*) FROM feeds
  UNION ALL SELECT 'entries', COUNT(*) FROM entries
  UNION ALL SELECT 'entry_contents', COUNT(*) FROM entry_contents
  UNION ALL SELECT 'subscription_categories', COUNT(*) FROM subscription_categories
  UNION ALL SELECT 'feed_subscriptions', COUNT(*) FROM feed_subscriptions
  UNION ALL SELECT 'entry_interactions', COUNT(*) FROM entry_interactions
  UNION ALL SELECT 'chart_daily_activity', COUNT(*) FROM chart_daily_activity
  UNION ALL SELECT 'app_tokens', COUNT(*) FROM app_tokens
  UNION ALL SELECT 'feed_refreshes', COUNT(*) FROM feed_refreshes
  UNION ALL SELECT 'entry_summaries', COUNT(*) FROM entry_summaries
);`).CombinedOutput()
	if err != nil {
		t.Fatal(err)
	}
	want := "users:1,feeds:1,entries:1,entry_contents:1,subscription_categories:1,feed_subscriptions:1,entry_interactions:1,chart_daily_activity:0,app_tokens:1,feed_refreshes:1,entry_summaries:1"
	if strings.TrimSpace(string(output)) != want {
		t.Fatalf("representative target output = %q, want %q", output, want)
	}
}

func TestValidatorDetectsCorruption(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "artifact")
	writeUserArtifact(t, root, 2, 3, false)
	path := filepath.Join(root, "01-users-000001.jsonl")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	data[len(data)/2] ^= 1
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := validateArtifact(root); err == nil || !strings.Contains(err.Error(), "SHA-256 mismatch") {
		t.Fatalf("error = %v, want corruption detection", err)
	}
}

func TestValidatorRejectsUnsafeArtifactID(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "artifact")
	writeUserArtifact(t, root, 2, 1, true)
	if _, err := validateArtifact(root); err == nil || !strings.Contains(err.Error(), "JavaScript-safe") {
		t.Fatalf("error = %v, want unsafe ID rejection", err)
	}
}

func TestDryRunManifestCannotRender(t *testing.T) {
	t.Parallel()
	root := filepath.Join(t.TempDir(), "artifact")
	writer, err := newArtifactWriter(root, 10, testManifest(true))
	if err != nil {
		t.Fatal(err)
	}
	if err := writeManifest(root, writer.manifest); err != nil {
		t.Fatal(err)
	}
	if _, err := validateArtifact(root); err == nil || !strings.Contains(err.Error(), "metadata only") {
		t.Fatalf("error = %v", err)
	}
}

func writeUserArtifact(t *testing.T, root string, chunkSize, count int, unsafe bool) {
	t.Helper()
	writer, err := newArtifactWriter(root, chunkSize, testManifest(false))
	if err != nil {
		t.Fatal(err)
	}
	for index := 1; index <= count; index++ {
		id := int64(index)
		if unsafe {
			id = maxSafeID + 1
		}
		handle := sha256.Sum256([]byte{byte(index)})
		email := fmt.Sprintf("user-%d@example.test", index)
		record := Record{Values: []Value{
			IntValue(id), BlobValue(handle[:]), TextValue(email), TextValue(email),
			TextValue("O'Reader — 你好"), IntValue(boolToInt(index == 1)), NullValue(), IntValue(1_000), IntValue(1_001),
		}}
		if err := writer.append("users", record, &id); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.finish(); err != nil {
		t.Fatal(err)
	}
}

func writeRepresentativeArtifact(t *testing.T, root string) {
	t.Helper()
	writer, err := newArtifactWriter(root, 50, testManifest(false))
	if err != nil {
		t.Fatal(err)
	}
	blob := sha256.Sum256([]byte("representative"))
	content := "<article><p>Representative content</p></article>"
	contentHash := sha256.Sum256([]byte(content))
	records := map[string]Record{
		"users": {Values: []Value{
			IntValue(1), BlobValue(blob[:]), TextValue("owner@example.test"), TextValue("owner@example.test"),
			TextValue("Owner"), IntValue(1), NullValue(), IntValue(1_000), IntValue(1_000),
		}},
		"feeds": {Values: []Value{
			IntValue(10), TextValue("Feed"), TextValue("https://example.test/feed.xml"), TextValue("https://example.test/"),
			NullValue(), NullValue(), NullValue(), TextValue("etag"), NullValue(), IntValue(0), IntValue(0),
			NullValue(), IntValue(1_000), IntValue(1_000), IntValue(1_000), NullValue(), NullValue(),
			IntValue(1_000), IntValue(1_000),
		}},
		"entries": {Values: []Value{
			IntValue(100), IntValue(10), BlobValue(blob[:]), TextValue("guid:100"), TextValue("Entry"),
			TextValue("https://example.test/entry"), TextValue("Author"), IntValue(1_000), IntValue(1_000),
			TextValue("stored"), IntValue(1_000), IntValue(1_000),
		}},
		"entry_contents": {Values: []Value{
			IntValue(100), TextValue(content), BlobValue(contentHash[:]), IntValue(int64(len([]byte(content)))),
			IntValue(1_000), IntValue(1_000),
		}},
		"subscription_categories": {Values: []Value{
			IntValue(20), IntValue(1), TextValue("News"), IntValue(1_000), IntValue(1_000),
		}},
		"feed_subscriptions": {Values: []Value{
			IntValue(1), IntValue(10), IntValue(20), TextValue("Custom Feed"), TextValue(`{"include":["cloudflare"]}`),
			IntValue(100), IntValue(1_000), IntValue(1_000),
		}},
		"entry_interactions": {Values: []Value{
			IntValue(1), IntValue(10), IntValue(100), NullValue(), NullValue(), IntValue(1_000),
			NullValue(), NullValue(), IntValue(1_000), IntValue(1_000),
		}},
		"app_tokens": {Values: []Value{
			IntValue(30), IntValue(1), TextValue("Reader"), BlobValue(blob[:]), TextValue("abcdefgh"),
			TextValue(`["google-reader"]`), NullValue(), NullValue(), NullValue(), IntValue(1_000), NullValue(),
		}},
		"feed_refreshes": {Values: []Value{
			IntValue(40), IntValue(10), NullValue(), IntValue(1_000), IntValue(1), IntValue(0), IntValue(200),
			IntValue(1), IntValue(1), IntValue(0), IntValue(20), NullValue(), NullValue(), IntValue(1_000),
		}},
		"entry_summaries": {Values: []Value{
			IntValue(50), IntValue(100), IntValue(1), NullValue(), BlobValue(contentHash[:]), TextValue("gemini-test"),
			TextValue("v1"), TextValue("<p>Summary</p>"), IntValue(1_000), IntValue(1_000),
		}},
	}
	for _, table := range foreignKeyOrder {
		record, ok := records[table]
		if !ok {
			continue
		}
		id := record.Values[0].Int
		if err := writer.append(table, record, &id); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.finish(); err != nil {
		t.Fatal(err)
	}
}

func testManifest(dryRun bool) Manifest {
	return Manifest{
		ArtifactVersion: artifactVersion,
		SchemaVersion:   "0004_chart_daily_activity",
		SourceVersion: SourceVersion{
			Database: "representative", PostgreSQL: "test", SnapshotPolicy: "REPEATABLE READ READ ONLY",
		},
		DryRun:      dryRun,
		AdminUserID: int64Ptr(1),
		Sources:     []SourceStats{{Name: "users", Count: 5, MinID: int64Ptr(1), MaxID: int64Ptr(5)}},
	}
}

func boolToInt(value bool) int64 {
	if value {
		return 1
	}
	return 0
}

func readDirectoryFiles(t *testing.T, root string) map[string]string {
	t.Helper()
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	result := make(map[string]string, len(entries))
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(root, entry.Name()))
		if err != nil {
			t.Fatal(err)
		}
		result[entry.Name()] = string(data)
	}
	return result
}

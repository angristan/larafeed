//nolint:noinlineerr // Scoped test assertions keep failure values local.
package main

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestUserRecordDeterministicAndExcludesForbiddenFields(t *testing.T) {
	t.Parallel()
	created := time.Date(2025, time.January, 2, 3, 4, 5, 123_456_789, time.UTC)
	row := sourceRow{
		"id": int64(42), "name": "Zoë O'Reader", "email": "zoe@example.test",
		"created_at": created, "updated_at": created.Add(time.Second), "target_is_admin": true,
		"password": "forbidden-password", "remember_token": "forbidden-remember",
		"two_factor_secret": "forbidden-totp", "email_verified_at": created,
	}
	first, err := userRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	second, err := userRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(mustJSON(t, first), mustJSON(t, second)) {
		t.Fatal("user transform is not deterministic")
	}
	if got := first.Values[1]; got.Kind != "blob" || len(got.Hex) != 64 {
		t.Fatalf("WebAuthn handle = %#v, want 32-byte BLOB", got)
	}
	if first.Values[5].Kind != "integer" || first.Values[5].Int != 1 {
		t.Fatalf("is_admin = %#v, want selected administrator", first.Values[5])
	}
	if first.Values[7].Int != created.UnixMilli() {
		t.Fatalf("created_at = %d, want epoch milliseconds", first.Values[7].Int)
	}
	serialized := string(mustJSON(t, first))
	for _, forbidden := range []string{"forbidden-password", "forbidden-remember", "forbidden-totp", "email_verified"} {
		if strings.Contains(serialized, forbidden) {
			t.Fatalf("serialized user contains forbidden field/value %q", forbidden)
		}
	}
}

func TestEntryAndContentTransformUnicodeQuotesAndOversize(t *testing.T) {
	t.Parallel()
	content := "<p>L’été d'O'Reilly — 你好</p>"
	row := sourceRow{
		"id": int64(8), "feed_id": int64(3), "title": "L'été", "url": "https://example.test/a?x='y'",
		"author": "李", "content": content, "published_at": time.Unix(100, 999_999_999).UTC(),
		"created_at": time.Unix(101, 0).UTC(), "updated_at": time.Unix(102, 0).UTC(),
	}
	entry, err := entryRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Values[9].Text != "stored" || len(entry.Values[2].Hex) != 64 {
		t.Fatalf("entry status/hash = %q/%d", entry.Values[9].Text, len(entry.Values[2].Hex))
	}
	stored, err := entryContentRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	if stored == nil || stored.Values[3].Int != int64(len([]byte(content))) || len(stored.Values[2].Hex) != 64 {
		t.Fatalf("stored content = %#v", stored)
	}

	oversized := strings.Repeat("é", maxContentBytes/2+1)
	row["content"] = oversized
	entry, err = entryRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	if entry.Values[9].Text != "oversized" {
		t.Fatalf("status = %q, want oversized", entry.Values[9].Text)
	}
	stored, err = entryContentRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	if stored != nil {
		t.Fatal("oversized content must not produce entry_contents row")
	}
}

func TestInteractionWatermarkSparseMapping(t *testing.T) {
	t.Parallel()
	read := time.Unix(200, 0).UTC()
	starred := time.Unix(201, 0).UTC()
	base := sourceRow{
		"user_id": int64(1), "feed_id": int64(2), "entry_id": int64(10),
		"read_at": read, "created_at": read, "updated_at": read,
		"read_through_entry_id": int64(10),
	}
	record, err := interactionRecord(base)
	if err != nil {
		t.Fatal(err)
	}
	if record != nil {
		t.Fatal("watermark-covered read-only row must be omitted")
	}
	base["starred_at"] = starred
	record, err = interactionRecord(base)
	if err != nil {
		t.Fatal(err)
	}
	if record == nil || record.Values[3].Kind != "null" || record.Values[5].Int != starred.UnixMilli() {
		t.Fatalf("watermark-star mapping = %#v", record)
	}
	base["entry_id"] = int64(11)
	record, err = interactionRecord(base)
	if err != nil {
		t.Fatal(err)
	}
	if record == nil || record.Values[3].Int != 1 || record.Values[4].Int != read.UnixMilli() {
		t.Fatalf("post-watermark read override = %#v", record)
	}
}

func TestCredentialsHashSecretsAndNormalizeScopes(t *testing.T) {
	t.Parallel()
	legacyHash := strings.Repeat("ab", 32)
	pat, err := personalAccessTokenRecord(sourceRow{
		"id": int64(7), "tokenable_id": int64(1), "tokenable_type": "App\\Models\\User",
		"name": "Reader's token", "token": legacyHash, "abilities": `["reader-api"]`,
		"created_at": time.Unix(1, 0).UTC(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if pat == nil || pat.Values[3].Kind != "blob" || pat.Values[5].Text != `["google-reader"]` {
		t.Fatalf("PAT mapping = %#v", pat)
	}
	if strings.Contains(string(mustJSON(t, pat)), `"token":"`) {
		t.Fatal("raw token field was serialized")
	}

	fever, err := feverTokenRecord(sourceRow{
		"id": int64(1), "fever_api_key": "0123456789abcdef0123456789abcdef", "created_at": time.Unix(1, 0).UTC(),
	}, 8)
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(mustJSON(t, fever))
	if strings.Contains(serialized, "0123456789abcdef0123456789abcdef") || len(fever.Values[10].Hex) != 64 {
		t.Fatal("raw Fever verifier leaked or was not SHA-256 hashed")
	}
}

func TestCanonicalJSON(t *testing.T) {
	t.Parallel()
	value, err := canonicalJSONValue([]byte(`{"z":true,"a":"é"}`))
	if err != nil {
		t.Fatal(err)
	}
	if value.Text != `{"a":"é","z":true}` {
		t.Fatalf("canonical JSON = %s", value.Text)
	}
}

func TestInvalidSafeID(t *testing.T) {
	t.Parallel()
	_, err := userRecord(sourceRow{"id": maxSafeID + 1, "name": "x", "email": "x@example.test"})
	if err == nil || !strings.Contains(err.Error(), "JavaScript-safe") {
		t.Fatalf("error = %v", err)
	}
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return data
}

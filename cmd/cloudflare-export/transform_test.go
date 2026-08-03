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
	sanitizedContent := sanitizeEntryContent(content)
	if stored == nil || stored.Values[1].Text != sanitizedContent || stored.Values[3].Int != int64(len([]byte(sanitizedContent))) || len(stored.Values[2].Hex) != 64 {
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

func TestEntryContentClassificationUsesSanitizedSize(t *testing.T) {
	t.Parallel()

	t.Run("active content removed before classification", func(t *testing.T) {
		content := `<p>kept</p><script>` + strings.Repeat("x", maxContentBytes) + `</script>`
		row := sourceRow{
			"id": int64(8), "feed_id": int64(3), "title": "Entry", "url": "https://example.test/entry",
			"content": content,
		}

		entry, err := entryRecord(row)
		if err != nil {
			t.Fatal(err)
		}
		if entry.Values[9].Text != "stored" {
			t.Fatalf("status = %q, want stored after removing oversized script", entry.Values[9].Text)
		}
		stored, err := entryContentRecord(row)
		if err != nil {
			t.Fatal(err)
		}
		if stored == nil || stored.Values[1].Text != "<p>kept</p>" || stored.Values[3].Int != int64(len("<p>kept</p>")) {
			t.Fatalf("stored sanitized content = %#v", stored)
		}
	})

	t.Run("safe attributes added before classification", func(t *testing.T) {
		prefix := `<a href="https://example.test/article">`
		suffix := `</a>`
		content := prefix + strings.Repeat("a", maxContentBytes-len(prefix)-len(suffix)) + suffix
		if len(content) != maxContentBytes {
			t.Fatalf("test fixture size = %d, want %d", len(content), maxContentBytes)
		}
		row := sourceRow{
			"id": int64(9), "feed_id": int64(3), "title": "Entry", "url": "https://example.test/entry-2",
			"content": content,
		}

		entry, err := entryRecord(row)
		if err != nil {
			t.Fatal(err)
		}
		if entry.Values[9].Text != "oversized" {
			t.Fatalf("status = %q, want oversized after adding safe link attributes", entry.Values[9].Text)
		}
		stored, err := entryContentRecord(row)
		if err != nil {
			t.Fatal(err)
		}
		if stored != nil {
			t.Fatal("sanitized oversized content must not produce entry_contents row")
		}
	})
}

func TestEntryContentSanitizationAndHashAreDeterministic(t *testing.T) {
	t.Parallel()

	row := sourceRow{
		"id": int64(10), "feed_id": int64(3), "title": "Résumé", "url": "https://example.test/deterministic",
		"content": `<p>Hello <strong>世界</strong> &amp; café.</p><script>alert(1)</script>` +
			`<a href="https://example.test/x">Lire</a>`,
	}
	first, err := entryContentRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	second, err := entryContentRecord(row)
	if err != nil {
		t.Fatal(err)
	}
	if first == nil || second == nil {
		t.Fatal("sanitized content was unexpectedly omitted")
	}

	const expectedContent = `<p>Hello <strong>世界</strong> &amp; café.</p><a href="https://example.test/x" rel="nofollow noopener noreferrer" target="_blank">Lire</a>`
	const expectedHash = "39dd8b68c18e1ed9ef785cd55b845d8cad0603253770a4d3fd22d7400a8f3454"
	if first.Values[1].Text != expectedContent {
		t.Fatalf("content = %q, want %q", first.Values[1].Text, expectedContent)
	}
	if first.Values[2].Hex != expectedHash {
		t.Fatalf("content hash = %q, want %q", first.Values[2].Hex, expectedHash)
	}
	if !bytes.Equal(mustJSON(t, first), mustJSON(t, second)) {
		t.Fatal("sanitized content transform or hash is not deterministic")
	}
	if first.Values[3].Int != int64(len([]byte(expectedContent))) {
		t.Fatalf("encoded size = %d, want sanitized byte size %d", first.Values[3].Int, len([]byte(expectedContent)))
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

func TestSubscriptionFilterCompatibility(t *testing.T) {
	t.Parallel()
	base := sourceRow{
		"user_id": int64(1), "feed_id": int64(2), "category_id": int64(3),
		"filter_rules": `{"exclude_title":["", " paid "],"exclude_content":[],"exclude_author":[]}`,
	}
	if _, err := subscriptionRecord(base); err != nil {
		t.Fatalf("compatible legacy filters: %v", err)
	}

	tooMany := make([]string, maxFilterPatternsPerField+1)
	for index := range tooMany {
		tooMany[index] = "pattern"
	}
	encoded, err := json.Marshal(map[string]any{"exclude_title": tooMany})
	if err != nil {
		t.Fatal(err)
	}
	base["filter_rules"] = encoded
	if _, err = subscriptionRecord(base); err == nil || !strings.Contains(err.Error(), "target limit") {
		t.Fatalf("too-many-pattern error = %v", err)
	}

	base["filter_rules"] = `{"exclude_content":["` + strings.Repeat("x", maxFilterPatternLength+1) + `"]}`
	if _, err = subscriptionRecord(base); err == nil || !strings.Contains(err.Error(), "UTF-16") {
		t.Fatalf("oversized-pattern error = %v", err)
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

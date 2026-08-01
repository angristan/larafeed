package main

import (
	"encoding/json"
	"fmt"
)

const (
	artifactVersion       = 1
	maxSafeID             = int64(9007199254740991)
	maxContentBytes       = 1_800_000
	maxArtifactChunkBytes = 16_000_000
)

var cleanTargetDeleteOrder = []string{
	"outbox_messages",
	"opml_import_items",
	"opml_imports",
	"entry_summaries",
	"feed_refreshes",
	"jobs",
	"entry_interactions",
	"feed_subscriptions",
	"subscription_categories",
	"entry_contents",
	"entries",
	"feeds",
	"app_tokens",
	"security_events",
	"webauthn_challenges",
	"sessions",
	"passkeys",
	"user_access_links",
	"users",
}

var foreignKeyOrder = []string{
	"users",
	"feeds",
	"entries",
	"entry_contents",
	"subscription_categories",
	"feed_subscriptions",
	"entry_interactions",
	"app_tokens",
	"feed_refreshes",
	"entry_summaries",
}

type Manifest struct {
	ArtifactVersion int           `json:"artifact_version"`
	SchemaVersion   string        `json:"schema_version"`
	SourceVersion   SourceVersion `json:"source_version"`
	DryRun          bool          `json:"dry_run"`
	ChunkSize       int           `json:"chunk_size"`
	MaxChunkBytes   int           `json:"max_chunk_bytes"`
	AdminUserID     *int64        `json:"admin_user_id"`
	Sources         []SourceStats `json:"sources"`
	Tables          []TableStats  `json:"tables"`
	Warnings        []string      `json:"warnings"`
}

type SourceVersion struct {
	Database       string `json:"database"`
	PostgreSQL     string `json:"postgresql"`
	GooseVersion   *int64 `json:"goose_version"`
	SnapshotPolicy string `json:"snapshot_policy"`
}

type SourceStats struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
	MinID *int64 `json:"min_id"`
	MaxID *int64 `json:"max_id"`
}

type TableStats struct {
	Name        string      `json:"name"`
	Columns     []string    `json:"columns"`
	OutputCount int64       `json:"output_count"`
	MinID       *int64      `json:"min_id"`
	MaxID       *int64      `json:"max_id"`
	Chunks      []ChunkInfo `json:"chunks"`
}

type ChunkInfo struct {
	File   string `json:"file"`
	Rows   int    `json:"rows"`
	SHA256 string `json:"sha256"`
	MinID  *int64 `json:"min_id"`
	MaxID  *int64 `json:"max_id"`
}

// Value has an explicit kind so JSON never loses INTEGER precision or BLOB type.
type Value struct {
	Kind string `json:"kind"`
	Int  int64  `json:"int,omitempty"`
	Text string `json:"text,omitempty"`
	Hex  string `json:"hex,omitempty"`
}

func NullValue() Value           { return Value{Kind: "null"} }
func IntValue(value int64) Value { return Value{Kind: "integer", Int: value} }
func TextValue(value string) Value {
	return Value{Kind: "text", Text: value}
}
func BlobValue(value []byte) Value {
	return Value{Kind: "blob", Hex: fmt.Sprintf("%x", value)}
}

type Record struct {
	Values []Value `json:"values"`
}

func marshalRecord(record Record) ([]byte, error) {
	data, err := json.Marshal(record)
	if err != nil {
		return nil, fmt.Errorf("marshal record: %w", err)
	}
	return append(data, '\n'), nil
}

var tableColumns = map[string][]string{
	"users": {
		"id", "webauthn_user_handle", "username", "email", "display_name",
		"is_admin", "disabled_at", "created_at", "updated_at",
	},
	"feeds": {
		"id", "name", "feed_url", "site_url", "favicon_url", "favicon_is_dark",
		"favicon_updated_at", "etag", "last_modified", "is_gone", "consecutive_failures",
		"last_attempt_at", "last_successful_refresh_at", "latest_entry_at", "next_refresh_at",
		"last_error_class", "last_error_message", "created_at", "updated_at",
	},
	"entries": {
		"id", "feed_id", "deduplication_key", "source_id", "title", "url", "author",
		"published_at", "source_updated_at", "content_status", "created_at", "updated_at",
	},
	"entry_contents": {
		"entry_id", "content_html", "content_hash", "encoded_size_bytes", "created_at", "updated_at",
	},
	"subscription_categories": {
		"id", "user_id", "name", "created_at", "updated_at",
	},
	"feed_subscriptions": {
		"user_id", "feed_id", "category_id", "custom_feed_name", "filter_rules_json",
		"read_through_entry_id", "created_at", "updated_at",
	},
	"entry_interactions": {
		"user_id", "feed_id", "entry_id", "read_override", "read_changed_at", "starred_at",
		"archived_at", "filtered_at", "created_at", "updated_at",
	},
	"app_tokens": {
		"id", "user_id", "name", "token_hash", "token_prefix", "scopes_json", "last_used_at",
		"expires_at", "revoked_at", "created_at", "fever_verifier_hash",
	},
	"feed_refreshes": {
		"id", "feed_id", "job_id", "refreshed_at", "was_successful", "was_not_modified",
		"http_status", "entries_seen", "entries_created", "entries_updated", "duration_ms",
		"error_class", "error_message", "created_at",
	},
	"entry_summaries": {
		"id", "entry_id", "requested_by_user_id", "job_id", "content_hash", "model",
		"prompt_version", "summary_html", "created_at", "updated_at",
	},
}

// Only these positions are identifiers. source_id and operation-like text are not IDs.
var tableIDPositions = map[string][]int{
	"users":                   {0},
	"feeds":                   {0},
	"entries":                 {0, 1},
	"entry_contents":          {0},
	"subscription_categories": {0, 1},
	"feed_subscriptions":      {0, 1, 2, 5},
	"entry_interactions":      {0, 1, 2},
	"app_tokens":              {0, 1},
	"feed_refreshes":          {0, 1, 2},
	"entry_summaries":         {0, 1, 2, 3},
}

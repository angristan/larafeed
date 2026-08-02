package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"
)

type sourceRow map[string]any

func userRecord(row sourceRow) (Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return Record{}, err
	}
	err = validateSafeID(id)
	if err != nil {
		return Record{}, err
	}
	name, err := requiredText(row, "name")
	if err != nil {
		return Record{}, err
	}
	email, err := requiredText(row, "email")
	if err != nil {
		return Record{}, err
	}
	created := timestampOr(row["created_at"], 0)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	handle := sha256.Sum256([]byte(fmt.Sprintf("larafeed:webauthn-user-handle:v1:%d", id)))
	return Record{Values: []Value{
		IntValue(id), BlobValue(handle[:]), TextValue(email), TextValue(email), TextValue(name),
		boolValue(row["target_is_admin"]), NullValue(), IntValue(created), IntValue(updated),
	}}, nil
}

func feedRecord(row sourceRow) (Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return Record{}, err
	}
	name, err := requiredText(row, "name")
	if err != nil {
		return Record{}, err
	}
	feedURL, err := requiredText(row, "feed_url")
	if err != nil {
		return Record{}, err
	}
	created := timestampOr(row["created_at"], 0)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	lastSuccessful := nullableTimestamp(row["last_successful_refresh_at"])
	lastFailed := nullableTimestamp(row["last_failed_refresh_at"])
	lastAttempt := laterTimestamp(lastSuccessful, lastFailed)
	nextRefresh := nullableTimestamp(row["retry_after"])
	if nextRefresh == nil {
		nextRefresh = lastAttempt
	}
	if nextRefresh == nil {
		copy := updated
		nextRefresh = &copy
	}
	lastErrorClass := NullValue()
	if lastFailed != nil && (lastSuccessful == nil || *lastFailed > *lastSuccessful) {
		lastErrorClass = TextValue("legacy_refresh_failure")
	}
	return Record{Values: []Value{
		IntValue(id), TextValue(name), TextValue(feedURL), nullableTextValue(row["site_url"]),
		nullableTextValue(row["favicon_url"]), nullableBoolValue(row["favicon_is_dark"]),
		nullableTimestampValue(row["favicon_updated_at"]), nullableTextValue(row["etag"]),
		nullableTextValue(row["last_modified"]), boolValue(row["is_gone"]), nonNegativeIntValue(row["consecutive_failures"]),
		nullableIntValue(lastAttempt), nullableIntValue(lastSuccessful), nullableIntValue(lastFailed), nullableTimestampValue(row["latest_entry_at"]),
		IntValue(*nextRefresh), lastErrorClass, nullableTextValue(row["last_error_message"]), IntValue(created), IntValue(updated),
	}}, nil
}

func entryRecord(row sourceRow) (Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return Record{}, err
	}
	feedID, err := requiredInt(row, "feed_id")
	if err != nil {
		return Record{}, err
	}
	title, err := requiredTextAllowEmpty(row, "title")
	if err != nil {
		return Record{}, err
	}
	url, err := requiredText(row, "url")
	if err != nil {
		return Record{}, err
	}
	identity := "url:" + url
	if boolFrom(row["has_earlier_url_duplicate"]) {
		identity = fmt.Sprintf("legacy-entry:%d", id)
	}
	deduplicationKey := sha256.Sum256([]byte(identity))
	content := textFrom(row["content"])
	status := "empty"
	if content != nil {
		if len([]byte(*content)) > maxContentBytes {
			status = "oversized"
		} else if *content != "" {
			status = "stored"
		}
	}
	published := timestampOr(row["published_at"], 0)
	created := timestampOr(row["created_at"], published)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	return Record{Values: []Value{
		IntValue(id), IntValue(feedID), BlobValue(deduplicationKey[:]), NullValue(), TextValue(title),
		TextValue(url), nullableTextValue(row["author"]), IntValue(published), NullValue(), TextValue(status),
		IntValue(created), IntValue(updated),
	}}, nil
}

func entryContentRecord(row sourceRow) (*Record, error) {
	content := textFrom(row["content"])
	if content == nil || *content == "" || len([]byte(*content)) > maxContentBytes {
		return nil, nil
	}
	id, err := requiredInt(row, "id")
	if err != nil {
		return nil, err
	}
	created := timestampOr(row["created_at"], timestampOr(row["published_at"], 0))
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	hash := sha256.Sum256([]byte(*content))
	record := Record{Values: []Value{
		IntValue(id), TextValue(*content), BlobValue(hash[:]), IntValue(int64(len([]byte(*content)))),
		IntValue(created), IntValue(updated),
	}}
	return &record, nil
}

func categoryRecord(row sourceRow) (Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return Record{}, err
	}
	userID, err := requiredInt(row, "user_id")
	if err != nil {
		return Record{}, err
	}
	name, err := requiredText(row, "name")
	if err != nil {
		return Record{}, err
	}
	created := timestampOr(row["created_at"], 0)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	return Record{Values: []Value{IntValue(id), IntValue(userID), TextValue(name), IntValue(created), IntValue(updated)}}, nil
}

func subscriptionRecord(row sourceRow) (Record, error) {
	userID, err := requiredInt(row, "user_id")
	if err != nil {
		return Record{}, err
	}
	feedID, err := requiredInt(row, "feed_id")
	if err != nil {
		return Record{}, err
	}
	categoryID, err := requiredInt(row, "category_id")
	if err != nil {
		return Record{}, err
	}
	filterRules, err := canonicalJSONValue(row["filter_rules"])
	if err != nil {
		return Record{}, fmt.Errorf("subscription %d/%d filter_rules: %w", userID, feedID, err)
	}
	created := timestampOr(row["created_at"], 0)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	return Record{Values: []Value{
		IntValue(userID), IntValue(feedID), IntValue(categoryID), nullableTextValue(row["custom_feed_name"]),
		filterRules, nullableTimestampValue(row["read_through_entry_id"]), IntValue(created), IntValue(updated),
	}}, nil
}

func interactionRecord(row sourceRow) (*Record, error) {
	userID, err := requiredInt(row, "user_id")
	if err != nil {
		return nil, err
	}
	feedID, err := requiredInt(row, "feed_id")
	if err != nil {
		return nil, err
	}
	entryID, err := requiredInt(row, "entry_id")
	if err != nil {
		return nil, err
	}
	readAt := nullableTimestamp(row["read_at"])
	watermark := nullableInt(row["read_through_entry_id"])
	readOverride := NullValue()
	readChangedAt := NullValue()
	if readAt != nil && (watermark == nil || entryID > *watermark) {
		readOverride = IntValue(1)
		readChangedAt = IntValue(*readAt)
	}
	starred := nullableTimestamp(row["starred_at"])
	archived := nullableTimestamp(row["archived_at"])
	filtered := nullableTimestamp(row["filtered_at"])
	if readOverride.Kind == "null" && starred == nil && archived == nil && filtered == nil {
		return nil, nil
	}
	created := timestampOr(row["created_at"], firstTimestamp(readAt, starred, archived, filtered, int64Ptr(0)))
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	record := Record{Values: []Value{
		IntValue(userID), IntValue(feedID), IntValue(entryID), readOverride, readChangedAt,
		nullableIntValue(starred), nullableIntValue(archived), nullableIntValue(filtered), IntValue(created), IntValue(updated),
	}}
	return &record, nil
}

func personalAccessTokenRecord(row sourceRow) (*Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return nil, err
	}
	userID, err := requiredInt(row, "tokenable_id")
	if err != nil {
		return nil, err
	}
	if tokenableType, _ := optionalText(row, "tokenable_type"); tokenableType != "App\\Models\\User" {
		return nil, nil
	}
	abilities, err := parseLegacyAbilities(row["abilities"])
	if err != nil {
		return nil, fmt.Errorf("personal_access_tokens %d abilities: %w", id, err)
	}
	if !abilities["reader-api"] && !abilities["*"] {
		return nil, nil
	}
	tokenHex, err := requiredText(row, "token")
	if err != nil {
		return nil, err
	}
	tokenHash, err := hex.DecodeString(tokenHex)
	if err != nil || len(tokenHash) != 32 {
		return nil, fmt.Errorf("personal_access_tokens %d token is not a SHA-256 hex digest", id)
	}
	name, err := requiredText(row, "name")
	if err != nil {
		return nil, err
	}
	created := timestampOr(row["created_at"], 0)
	record := Record{Values: []Value{
		IntValue(id), IntValue(userID), TextValue(name), BlobValue(tokenHash), TextValue(tokenHex[:8]),
		TextValue(`["google-reader"]`), nullableTimestampValue(row["last_used_at"]), nullableTimestampValue(row["expires_at"]),
		NullValue(), IntValue(created), NullValue(),
	}}
	return &record, nil
}

func feverTokenRecord(row sourceRow, id int64) (*Record, error) {
	userID, err := requiredInt(row, "id")
	if err != nil {
		return nil, err
	}
	legacyKey, _ := optionalText(row, "fever_api_key")
	if legacyKey == "" {
		return nil, nil
	}
	verifier := sha256.Sum256([]byte(strings.ToLower(legacyKey)))
	unusableTokenHash := sha256.Sum256([]byte(fmt.Sprintf("larafeed:migrated-fever-only:v1:%d", userID)))
	created := timestampOr(row["created_at"], 0)
	record := Record{Values: []Value{
		IntValue(id), IntValue(userID), TextValue("Migrated Fever credential"), BlobValue(unusableTokenHash[:]),
		TextValue("legacy-fever"), TextValue(`["fever"]`), NullValue(), NullValue(), NullValue(), IntValue(created), BlobValue(verifier[:]),
	}}
	return &record, nil
}

func refreshRecord(row sourceRow) (Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return Record{}, err
	}
	feedID, err := requiredInt(row, "feed_id")
	if err != nil {
		return Record{}, err
	}
	refreshed := timestampOr(row["refreshed_at"], 0)
	created := timestampOr(row["created_at"], refreshed)
	success := boolValue(row["was_successful"])
	errorClass := NullValue()
	if success.Int == 0 {
		errorClass = TextValue("legacy_refresh_failure")
	}
	return Record{Values: []Value{
		IntValue(id), IntValue(feedID), NullValue(), IntValue(refreshed), success, IntValue(0), NullValue(),
		IntValue(0), nonNegativeIntValue(row["entries_created"]), IntValue(0), NullValue(), errorClass,
		nullableTextValue(row["error_message"]), IntValue(created),
	}}, nil
}

func dailyRefreshRecord(row sourceRow) (Record, error) {
	feedID, err := requiredInt(row, "feed_id")
	if err != nil {
		return Record{}, err
	}
	dayStart, err := requiredInt(row, "day_start")
	if err != nil {
		return Record{}, err
	}
	created := timestampOr(row["created_at"], dayStart)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	return Record{Values: []Value{
		IntValue(feedID), IntValue(dayStart), nonNegativeIntValue(row["attempts_count"]),
		nonNegativeIntValue(row["successes_count"]), nonNegativeIntValue(row["failures_count"]),
		nonNegativeIntValue(row["entries_created_count"]), IntValue(created), IntValue(updated),
	}}, nil
}

func summaryRecord(row sourceRow) (Record, error) {
	id, err := requiredInt(row, "id")
	if err != nil {
		return Record{}, err
	}
	entryID, err := requiredInt(row, "entry_id")
	if err != nil {
		return Record{}, err
	}
	contentHash, err := blob32(row["content_hash"])
	if err != nil {
		return Record{}, fmt.Errorf("entry_summaries %d content_hash: %w", id, err)
	}
	model, err := requiredText(row, "model")
	if err != nil {
		return Record{}, err
	}
	promptVersion, err := requiredText(row, "prompt_version")
	if err != nil {
		return Record{}, err
	}
	summaryHTML, err := requiredText(row, "summary_html")
	if err != nil {
		return Record{}, err
	}
	created := timestampOr(row["created_at"], 0)
	updated := maxInt64(created, timestampOr(row["updated_at"], created))
	return Record{Values: []Value{
		IntValue(id), IntValue(entryID), nullableTimestampValue(row["requested_by_user_id"]), NullValue(), BlobValue(contentHash),
		TextValue(model), TextValue(promptVersion), TextValue(summaryHTML), IntValue(created), IntValue(updated),
	}}, nil
}

func validateSafeID(id int64) error {
	if id < 1 || id > maxSafeID {
		return fmt.Errorf("identifier %d is outside JavaScript-safe target range", id)
	}
	return nil
}

func requiredInt(row sourceRow, key string) (int64, error) {
	value := nullableInt(row[key])
	if value == nil {
		return 0, fmt.Errorf("%s is missing or not an integer", key)
	}
	err := validateSafeID(*value)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return *value, nil
}

func nullableInt(value any) *int64 {
	switch typed := value.(type) {
	case int64:
		return &typed
	case int32:
		converted := int64(typed)
		return &converted
	case int:
		converted := int64(typed)
		return &converted
	case *int64:
		return typed
	default:
		return nil
	}
}

func requiredText(row sourceRow, key string) (string, error) {
	value, err := requiredTextAllowEmpty(row, key)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("%s is empty", key)
	}
	return value, nil
}

func requiredTextAllowEmpty(row sourceRow, key string) (string, error) {
	value, ok := optionalText(row, key)
	if !ok || !utf8.ValidString(value) {
		return "", fmt.Errorf("%s is missing or invalid UTF-8", key)
	}
	return value, nil
}

func optionalText(row sourceRow, key string) (string, bool) {
	switch value := row[key].(type) {
	case string:
		return value, true
	case []byte:
		return string(value), true
	default:
		return "", false
	}
}

func textFrom(value any) *string {
	switch typed := value.(type) {
	case string:
		return &typed
	case []byte:
		converted := string(typed)
		return &converted
	default:
		return nil
	}
}

func timestampOr(value any, fallback int64) int64 {
	if timestamp := nullableTimestamp(value); timestamp != nil {
		return *timestamp
	}
	return fallback
}

func nullableTimestamp(value any) *int64 {
	if value == nil {
		return nil
	}
	if number := nullableInt(value); number != nil {
		return number
	}
	if timestamp, ok := value.(time.Time); ok {
		milliseconds := timestamp.UTC().UnixMilli()
		return &milliseconds
	}
	return nil
}

func nullableTextValue(value any) Value {
	if text := textFrom(value); text != nil {
		return TextValue(*text)
	}
	return NullValue()
}

func nullableTimestampValue(value any) Value { return nullableIntValue(nullableTimestamp(value)) }

func nullableIntValue(value *int64) Value {
	if value == nil {
		return NullValue()
	}
	return IntValue(*value)
}

func boolValue(value any) Value {
	if boolFrom(value) {
		return IntValue(1)
	}
	return IntValue(0)
}

func nullableBoolValue(value any) Value {
	if value == nil {
		return NullValue()
	}
	return boolValue(value)
}

func boolFrom(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int64:
		return typed != 0
	case int32:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}

func nonNegativeIntValue(value any) Value {
	number := nullableInt(value)
	if number == nil || *number < 0 {
		return IntValue(0)
	}
	return IntValue(*number)
}

func canonicalJSONValue(value any) (Value, error) {
	if value == nil {
		return NullValue(), nil
	}
	var raw []byte
	switch typed := value.(type) {
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return Value{}, err
		}
		raw = encoded
	}
	var decoded any
	err := json.Unmarshal(raw, &decoded)
	if err != nil {
		return Value{}, err
	}
	canonical, err := json.Marshal(decoded)
	if err != nil {
		return Value{}, err
	}
	return TextValue(string(canonical)), nil
}

func parseLegacyAbilities(value any) (map[string]bool, error) {
	result := make(map[string]bool)
	if value == nil {
		return result, nil
	}
	text := textFrom(value)
	if text == nil {
		return nil, fmt.Errorf("not text")
	}
	var abilities []string
	err := json.Unmarshal([]byte(*text), &abilities)
	if err != nil {
		return nil, err
	}
	for _, ability := range abilities {
		result[ability] = true
	}
	return result, nil
}

func blob32(value any) ([]byte, error) {
	var blob []byte
	switch typed := value.(type) {
	case []byte:
		blob = append([]byte(nil), typed...)
	case string:
		decoded, err := hex.DecodeString(typed)
		if err != nil {
			return nil, err
		}
		blob = decoded
	default:
		return nil, fmt.Errorf("not bytes")
	}
	if len(blob) != 32 {
		return nil, fmt.Errorf("must be 32 bytes")
	}
	return blob, nil
}

func laterTimestamp(left, right *int64) *int64 {
	if left == nil {
		return right
	}
	if right == nil || *left >= *right {
		return left
	}
	return right
}

func firstTimestamp(values ...*int64) int64 {
	for _, value := range values {
		if value != nil {
			return *value
		}
	}
	return 0
}

func int64Ptr(value int64) *int64 { return &value }
func maxInt64(left, right int64) int64 {
	if left > right {
		return left
	}
	return right
}

package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
)

type exporter struct {
	tx          pgx.Tx
	chunkSize   int
	adminUserID *int64
	writer      *artifactWriter
	columns     map[string]map[string]bool
	warnings    []string
	watermarks  map[string]*int64
}

func exportPostgres(ctx context.Context, databaseURL, outputDir string, chunkSize int, dryRun bool, adminUserID *int64) error {
	connection, err := pgx.Connect(ctx, databaseURL)
	if err != nil {
		// pgx errors are normally credential-safe, but do not risk echoing a
		// malformed DATABASE_URL supplied by an operator.
		return errors.New("connect to PostgreSQL failed; check DATABASE_URL and network access")
	}
	defer connection.Close(ctx) //nolint:errcheck

	tx, err := connection.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return fmt.Errorf("begin read-only snapshot: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	_, err = tx.Exec(ctx, "SET LOCAL statement_timeout = '15min'")
	if err != nil {
		return fmt.Errorf("set snapshot timeout: %w", err)
	}

	columns, err := inspectColumns(ctx, tx)
	if err != nil {
		return err
	}
	manifest, warnings, err := inspectMetadata(ctx, tx, columns, chunkSize, dryRun)
	if err != nil {
		return err
	}
	manifest.AdminUserID = adminUserID
	if adminUserID != nil {
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM users WHERE id = $1)`, *adminUserID).Scan(&exists)
		if err != nil {
			return fmt.Errorf("validate selected administrator: %w", err)
		}
		if !exists {
			return fmt.Errorf("selected administrator user %d does not exist", *adminUserID)
		}
		warnings = append(warnings, fmt.Sprintf("Source user %d is the explicit target administrator.", *adminUserID))
	}
	writer, err := newArtifactWriter(outputDir, chunkSize, manifest)
	if err != nil {
		return err
	}
	writer.manifest.Warnings = warnings
	if dryRun {
		err = writeManifest(outputDir, writer.manifest)
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	e := &exporter{tx: tx, chunkSize: chunkSize, adminUserID: adminUserID, writer: writer, columns: columns, warnings: warnings, watermarks: make(map[string]*int64)}
	err = e.exportAll(ctx)
	if err != nil {
		return err
	}
	sort.Strings(e.warnings)
	writer.manifest.Warnings = e.warnings
	err = writer.finish()
	if err != nil {
		return err
	}
	err = tx.Commit(ctx)
	if err != nil {
		return fmt.Errorf("commit read-only snapshot: %w", err)
	}
	return nil
}

func (e *exporter) exportAll(ctx context.Context) error {
	steps := []func(context.Context) error{
		e.exportUsers, e.exportFeeds, e.exportEntries, e.exportEntryContents,
		e.exportCategories, e.exportSubscriptions, e.exportInteractions,
		e.exportPersonalAccessTokens, e.exportFeverCredentials, e.exportRefreshes,
		e.exportDailyRefreshes, e.exportSummaries,
	}
	for _, step := range steps {
		err := step(ctx)
		if err != nil {
			return err
		}
	}
	return nil
}

func (e *exporter) exportUsers(ctx context.Context) error {
	query := `SELECT id, name, email, created_at, updated_at FROM users WHERE id > $1 ORDER BY id LIMIT $2`
	return e.keyset(ctx, "users", query, func(row sourceRow) error {
		id := nullableInt(row["id"])
		row["target_is_admin"] = id != nil && e.adminUserID != nil && *id == *e.adminUserID
		record, err := userRecord(row)
		if err != nil {
			return fmt.Errorf("transform user: %w", err)
		}
		return e.writer.append("users", record, id)
	})
}

func (e *exporter) exportFeeds(ctx context.Context) error {
	query := fmt.Sprintf(`SELECT f.id, f.name, f.feed_url, f.site_url, f.favicon_url,
		f.favicon_is_dark, f.favicon_updated_at, %s AS etag, %s AS last_modified,
		%s AS is_gone, %s AS consecutive_failures, %s AS retry_after,
		f.last_successful_refresh_at, f.last_failed_refresh_at, f.last_error_message,
		f.created_at, f.updated_at,
		(SELECT MAX(e.published_at) FROM entries e WHERE e.feed_id = f.id) AS latest_entry_at
		FROM feeds f WHERE f.id > $1 ORDER BY f.id LIMIT $2`,
		e.columnOr("feeds", "etag", "NULL::text"), e.columnOr("feeds", "last_modified", "NULL::text"),
		e.columnOr("feeds", "is_gone", "FALSE"), e.columnOr("feeds", "consecutive_failures", "0::bigint"),
		e.columnOr("feeds", "retry_after", "NULL::timestamptz"))
	return e.keyset(ctx, "feeds", query, func(row sourceRow) error {
		record, err := feedRecord(row)
		if err != nil {
			return fmt.Errorf("transform feed: %w", err)
		}
		return e.writer.append("feeds", record, nullableInt(row["id"]))
	})
}

func (e *exporter) exportEntries(ctx context.Context) error {
	query := `SELECT e.id, e.feed_id, e.title, e.url, e.author, e.content, e.published_at,
		e.created_at, e.updated_at,
		EXISTS (SELECT 1 FROM entries prior WHERE prior.feed_id = e.feed_id
			AND prior.url = e.url AND prior.id < e.id) AS has_earlier_url_duplicate
		FROM entries e WHERE e.id > $1 ORDER BY e.id LIMIT $2`
	return e.keyset(ctx, "entries", query, func(row sourceRow) error {
		record, err := entryRecord(row)
		if err != nil {
			return fmt.Errorf("transform entry: %w", err)
		}
		return e.writer.append("entries", record, nullableInt(row["id"]))
	})
}

func (e *exporter) exportEntryContents(ctx context.Context) error {
	query := `SELECT id, content, published_at, created_at, updated_at FROM entries
		WHERE content IS NOT NULL AND id > $1 ORDER BY id LIMIT $2`
	return e.keyset(ctx, "entry_contents", query, func(row sourceRow) error {
		record, err := entryContentRecord(row)
		if err != nil {
			return fmt.Errorf("transform entry content: %w", err)
		}
		if record == nil {
			return nil
		}
		return e.writer.append("entry_contents", *record, nullableInt(row["id"]))
	})
}

func (e *exporter) exportCategories(ctx context.Context) error {
	query := `SELECT id, user_id, name, created_at, updated_at FROM subscription_categories
		WHERE id > $1 ORDER BY id LIMIT $2`
	return e.keyset(ctx, "subscription_categories", query, func(row sourceRow) error {
		record, err := categoryRecord(row)
		if err != nil {
			return fmt.Errorf("transform category: %w", err)
		}
		return e.writer.append("subscription_categories", record, nullableInt(row["id"]))
	})
}

func (e *exporter) exportSubscriptions(ctx context.Context) error {
	query := `SELECT fs.user_id, fs.feed_id, fs.category_id, fs.custom_feed_name, fs.filter_rules,
		fs.created_at, fs.updated_at,
		(SELECT MAX(read_entry.id) FROM entries read_entry
		 JOIN entry_interactions read_state ON read_state.user_id = fs.user_id
			AND read_state.entry_id = read_entry.id AND read_state.read_at IS NOT NULL
		 WHERE read_entry.feed_id = fs.feed_id
		   AND read_entry.id < COALESCE(
			(SELECT MIN(unread_entry.id) FROM entries unread_entry
			 LEFT JOIN entry_interactions unread_state ON unread_state.user_id = fs.user_id
				AND unread_state.entry_id = unread_entry.id
			 WHERE unread_entry.feed_id = fs.feed_id AND unread_state.read_at IS NULL),
			9223372036854775807)) AS read_through_entry_id
		FROM feed_subscriptions fs
		WHERE (fs.user_id, fs.feed_id) > ($1, $2)
		ORDER BY fs.user_id, fs.feed_id LIMIT $3`
	return e.compositeKeyset(ctx, "feed_subscriptions", query, func(row sourceRow) error {
		record, err := subscriptionRecord(row)
		if err != nil {
			return fmt.Errorf("transform subscription: %w", err)
		}
		userID := nullableInt(row["user_id"])
		feedID := nullableInt(row["feed_id"])
		e.watermarks[pairKey(*userID, *feedID)] = nullableInt(row["read_through_entry_id"])
		return e.writer.append("feed_subscriptions", record, userID)
	})
}

func (e *exporter) exportInteractions(ctx context.Context) error {
	query := `SELECT ei.user_id, e.feed_id, ei.entry_id, ei.read_at, ei.starred_at,
		ei.archived_at, ei.filtered_at, ei.created_at, ei.updated_at
		FROM entry_interactions ei JOIN entries e ON e.id = ei.entry_id
		JOIN feed_subscriptions fs ON fs.user_id = ei.user_id AND fs.feed_id = e.feed_id
		WHERE (ei.user_id, ei.entry_id) > ($1, $2)
		ORDER BY ei.user_id, ei.entry_id LIMIT $3`
	return e.compositeKeyset(ctx, "entry_interactions", query, func(row sourceRow) error {
		userID := nullableInt(row["user_id"])
		feedID := nullableInt(row["feed_id"])
		row["read_through_entry_id"] = e.watermarks[pairKey(*userID, *feedID)]
		record, err := interactionRecord(row)
		if err != nil {
			return fmt.Errorf("transform interaction: %w", err)
		}
		if record == nil {
			return nil
		}
		return e.writer.append("entry_interactions", *record, userID)
	})
}

func (e *exporter) exportPersonalAccessTokens(ctx context.Context) error {
	query := `SELECT id, tokenable_type, tokenable_id, name, token, abilities,
		last_used_at, expires_at, created_at FROM personal_access_tokens
		WHERE id > $1 ORDER BY id LIMIT $2`
	return e.keyset(ctx, "personal_access_tokens", query, func(row sourceRow) error {
		record, err := personalAccessTokenRecord(row)
		if err != nil {
			return fmt.Errorf("transform personal access token: %w", err)
		}
		if record == nil {
			return nil
		}
		return e.writer.append("app_tokens", *record, nullableInt(row["id"]))
	})
}

func (e *exporter) exportFeverCredentials(ctx context.Context) error {
	var maxTokenID int64
	err := e.tx.QueryRow(ctx, `SELECT COALESCE(MAX(id), 0) FROM personal_access_tokens`).Scan(&maxTokenID)
	if err != nil {
		return fmt.Errorf("find app token identifier range: %w", err)
	}
	nextID := maxTokenID
	query := `SELECT id, fever_api_key, created_at FROM users
		WHERE fever_api_key IS NOT NULL AND fever_api_key <> '' AND id > $1 ORDER BY id LIMIT $2`
	return e.keyset(ctx, "fever_credentials", query, func(row sourceRow) error {
		nextID++
		err := validateSafeID(nextID)
		if err != nil {
			return fmt.Errorf("synthetic Fever app token id: %w", err)
		}
		record, err := feverTokenRecord(row, nextID)
		if err != nil {
			return fmt.Errorf("transform Fever credential: %w", err)
		}
		if record == nil {
			return nil
		}
		return e.writer.append("app_tokens", *record, int64Ptr(nextID))
	})
}

func (e *exporter) exportRefreshes(ctx context.Context) error {
	query := `SELECT id, feed_id, refreshed_at, was_successful, entries_created,
		error_message, created_at FROM feed_refreshes WHERE id > $1 ORDER BY id LIMIT $2`
	return e.keyset(ctx, "feed_refreshes", query, func(row sourceRow) error {
		record, err := refreshRecord(row)
		if err != nil {
			return fmt.Errorf("transform feed refresh: %w", err)
		}
		return e.writer.append("feed_refreshes", record, nullableInt(row["id"]))
	})
}

func (e *exporter) exportDailyRefreshes(ctx context.Context) error {
	query := `WITH daily AS (
		SELECT feed_id,
			(EXTRACT(EPOCH FROM date_trunc('day', refreshed_at AT TIME ZONE 'UTC')) * 1000)::bigint AS day_start,
			COUNT(*)::bigint AS attempts_count,
			COUNT(*) FILTER (WHERE was_successful)::bigint AS successes_count,
			COUNT(*) FILTER (WHERE NOT was_successful)::bigint AS failures_count,
			COALESCE(SUM(entries_created), 0)::bigint AS entries_created_count,
			MIN(created_at) AS created_at,
			MAX(created_at) AS updated_at
		FROM feed_refreshes
		GROUP BY feed_id, date_trunc('day', refreshed_at AT TIME ZONE 'UTC')
	)
	SELECT * FROM daily
	WHERE (feed_id, day_start) > ($1, $2)
	ORDER BY feed_id, day_start LIMIT $3`
	return e.compositeKeyset(ctx, "chart_daily_refreshes", query, func(row sourceRow) error {
		record, err := dailyRefreshRecord(row)
		if err != nil {
			return fmt.Errorf("transform daily feed refresh: %w", err)
		}
		return e.writer.append("chart_daily_refreshes", record, nullableInt(row["feed_id"]))
	})
}

func (e *exporter) exportSummaries(ctx context.Context) error {
	if !e.hasTable("entry_summaries") {
		return nil
	}
	required := []string{"id", "entry_id", "content_hash", "model", "prompt_version", "summary_html", "created_at", "updated_at"}
	for _, column := range required {
		if !e.columns["entry_summaries"][column] {
			return nil
		}
	}
	query := fmt.Sprintf(`SELECT id, entry_id, %s AS requested_by_user_id, content_hash,
		model, prompt_version, summary_html, created_at, updated_at
		FROM entry_summaries WHERE id > $1 ORDER BY id LIMIT $2`,
		e.columnOr("entry_summaries", "requested_by_user_id", "NULL::bigint"))
	return e.keyset(ctx, "entry_summaries", query, func(row sourceRow) error {
		record, err := summaryRecord(row)
		if err != nil {
			return fmt.Errorf("transform summary: %w", err)
		}
		return e.writer.append("entry_summaries", record, nullableInt(row["id"]))
	})
}

func (e *exporter) keyset(ctx context.Context, name, query string, consume func(sourceRow) error) error {
	lastID := int64(0)
	for {
		rows, err := e.tx.Query(ctx, query, lastID, e.chunkSize)
		if err != nil {
			return fmt.Errorf("query %s chunk: %w", name, err)
		}
		count := 0
		for rows.Next() {
			row, err := valuesMap(rows)
			if err != nil {
				rows.Close()
				return fmt.Errorf("scan %s: %w", name, err)
			}
			id := nullableInt(row["id"])
			if id == nil || *id <= lastID {
				rows.Close()
				return fmt.Errorf("%s keyset returned invalid id", name)
			}
			lastID = *id
			err = consume(row)
			if err != nil {
				rows.Close()
				return err
			}
			count++
		}
		err = rows.Err()
		if err != nil {
			rows.Close()
			return fmt.Errorf("iterate %s: %w", name, err)
		}
		rows.Close()
		if count < e.chunkSize {
			return nil
		}
	}
}

func (e *exporter) compositeKeyset(ctx context.Context, name, query string, consume func(sourceRow) error) error {
	lastFirst, lastSecond := int64(0), int64(0)
	firstColumn := "user_id"
	secondColumn := "feed_id"
	if name == "entry_interactions" {
		secondColumn = "entry_id"
	}
	if name == "chart_daily_refreshes" {
		firstColumn = "feed_id"
		secondColumn = "day_start"
	}
	for {
		rows, err := e.tx.Query(ctx, query, lastFirst, lastSecond, e.chunkSize)
		if err != nil {
			return fmt.Errorf("query %s chunk: %w", name, err)
		}
		count := 0
		for rows.Next() {
			row, err := valuesMap(rows)
			if err != nil {
				rows.Close()
				return fmt.Errorf("scan %s: %w", name, err)
			}
			first, second := nullableInt(row[firstColumn]), nullableInt(row[secondColumn])
			if first == nil || second == nil || *first < lastFirst || (*first == lastFirst && *second <= lastSecond) {
				rows.Close()
				return fmt.Errorf("%s keyset returned invalid composite key", name)
			}
			lastFirst, lastSecond = *first, *second
			err = consume(row)
			if err != nil {
				rows.Close()
				return err
			}
			count++
		}
		err = rows.Err()
		if err != nil {
			rows.Close()
			return fmt.Errorf("iterate %s: %w", name, err)
		}
		rows.Close()
		if count < e.chunkSize {
			return nil
		}
	}
}

func valuesMap(rows pgx.Rows) (sourceRow, error) {
	values, err := rows.Values()
	if err != nil {
		return nil, err
	}
	fields := rows.FieldDescriptions()
	result := make(sourceRow, len(values))
	for index, value := range values {
		result[string(fields[index].Name)] = value
	}
	return result, nil
}

func (e *exporter) columnOr(table, column, fallback string) string {
	if e.columns[table][column] {
		return column
	}
	return fallback
}

func (e *exporter) hasTable(table string) bool { return e.columns[table] != nil }
func pairKey(first, second int64) string       { return fmt.Sprintf("%d/%d", first, second) }

func inspectColumns(ctx context.Context, tx pgx.Tx) (map[string]map[string]bool, error) {
	rows, err := tx.Query(ctx, `SELECT table_name, column_name FROM information_schema.columns
		WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`)
	if err != nil {
		return nil, fmt.Errorf("inspect source columns: %w", err)
	}
	defer rows.Close()
	result := make(map[string]map[string]bool)
	for rows.Next() {
		var table, column string
		err = rows.Scan(&table, &column)
		if err != nil {
			return nil, fmt.Errorf("scan source columns: %w", err)
		}
		if result[table] == nil {
			result[table] = make(map[string]bool)
		}
		result[table][column] = true
	}
	err = rows.Err()
	if err != nil {
		return nil, fmt.Errorf("iterate source columns: %w", err)
	}
	for _, required := range []string{"users", "feeds", "entries", "subscription_categories", "feed_subscriptions", "entry_interactions", "personal_access_tokens", "feed_refreshes"} {
		if result[required] == nil {
			return nil, fmt.Errorf("required source table %q does not exist", required)
		}
	}
	return result, nil
}

func inspectMetadata(ctx context.Context, tx pgx.Tx, columns map[string]map[string]bool, chunkSize int, dryRun bool) (Manifest, []string, error) {
	var source SourceVersion
	err := tx.QueryRow(ctx, `SELECT current_database(), current_setting('server_version')`).Scan(&source.Database, &source.PostgreSQL)
	if err != nil {
		return Manifest{}, nil, fmt.Errorf("inspect source version: %w", err)
	}
	source.SnapshotPolicy = "REPEATABLE READ READ ONLY"
	if columns["goose_db_version"] != nil {
		var gooseVersion *int64
		err = tx.QueryRow(ctx, `SELECT MAX(version_id) FROM goose_db_version WHERE is_applied`).Scan(&gooseVersion)
		if err != nil {
			return Manifest{}, nil, fmt.Errorf("inspect Goose version: %w", err)
		}
		source.GooseVersion = gooseVersion
	}

	manifest := Manifest{ArtifactVersion: artifactVersion, SchemaVersion: "0006_chart_daily_refreshes", SourceVersion: source, DryRun: dryRun, ChunkSize: chunkSize}
	sources := []struct{ name, table, key, predicate string }{
		{"users", "users", "id", ""}, {"feeds", "feeds", "id", ""}, {"entries", "entries", "id", ""},
		{"entry_contents", "entries", "id", "content IS NOT NULL"}, {"subscription_categories", "subscription_categories", "id", ""},
		{"feed_subscriptions", "feed_subscriptions", "user_id", ""}, {"entry_interactions", "entry_interactions", "user_id", ""},
		{"personal_access_tokens", "personal_access_tokens", "id", ""}, {"fever_credentials", "users", "id", "fever_api_key IS NOT NULL AND fever_api_key <> ''"},
		{"feed_refreshes", "feed_refreshes", "id", ""},
	}
	if columns["entry_summaries"] != nil {
		summaryKey := "NULL::bigint"
		if columns["entry_summaries"]["id"] {
			summaryKey = "id"
		}
		sources = append(sources, struct{ name, table, key, predicate string }{"entry_summaries", "entry_summaries", summaryKey, ""})
	}
	for _, spec := range sources {
		predicate := ""
		if spec.predicate != "" {
			predicate = " WHERE " + spec.predicate
		}
		query := fmt.Sprintf("SELECT COUNT(*), MIN(%s), MAX(%s) FROM %s%s", spec.key, spec.key, spec.table, predicate)
		var stats SourceStats
		stats.Name = spec.name
		err = tx.QueryRow(ctx, query).Scan(&stats.Count, &stats.MinID, &stats.MaxID)
		if err != nil {
			return Manifest{}, nil, fmt.Errorf("inspect %s source stats: %w", spec.name, err)
		}
		manifest.Sources = append(manifest.Sources, stats)
	}

	warnings := []string{
		"Authentication passwords, TOTP data, remember tokens, sessions, password resets, and email-verification state are intentionally excluded.",
		"Users must enroll passkeys after cutover; deterministic WebAuthn handles are identifiers, not credentials.",
		"Legacy interaction rows are compressed into per-subscription ingestion-ID watermarks plus sparse overrides.",
	}
	var oversized, duplicateURLs, unsupportedTokens, emailCollisions int64
	checks := []struct {
		query   string
		target  *int64
		message string
	}{
		{`SELECT COUNT(*) FROM entries WHERE content IS NOT NULL AND octet_length(content) > 1800000`, &oversized, "oversized entry contents are classified and omitted"},
		{`SELECT COALESCE(SUM(rows - 1), 0) FROM (SELECT COUNT(*) AS rows FROM entries GROUP BY feed_id, url HAVING COUNT(*) > 1) grouped`, &duplicateURLs, "duplicate feed URLs use legacy-ID deduplication fallbacks after the first row"},
		{`SELECT COUNT(*) FROM personal_access_tokens WHERE tokenable_type <> 'App\Models\User'
			OR abilities IS NULL OR NOT (abilities::jsonb ?| ARRAY['reader-api', '*'])`, &unsupportedTokens, "unsupported personal access tokens are omitted"},
		{`SELECT COALESCE(SUM(rows - 1), 0) FROM (SELECT COUNT(*) AS rows FROM users GROUP BY lower(email) HAVING COUNT(*) > 1) grouped`, &emailCollisions, "case-insensitive email collisions violate target username/email uniqueness"},
	}
	for _, check := range checks {
		err = tx.QueryRow(ctx, check.query).Scan(check.target)
		if err != nil {
			return Manifest{}, nil, fmt.Errorf("inspect migration warning: %w", err)
		}
		if *check.target > 0 {
			warnings = append(warnings, fmt.Sprintf("%d rows/groups: %s.", *check.target, check.message))
		}
	}
	if columns["entry_summaries"] == nil {
		warnings = append(warnings, "Source entry_summaries table is absent; no summaries will be exported.")
	} else {
		required := []string{"id", "entry_id", "content_hash", "model", "prompt_version", "summary_html", "created_at", "updated_at"}
		missing := make([]string, 0)
		for _, column := range required {
			if !columns["entry_summaries"][column] {
				missing = append(missing, column)
			}
		}
		if len(missing) > 0 {
			warnings = append(warnings, "Source entry_summaries is missing required columns and will be skipped: "+strings.Join(missing, ", ")+".")
		}
	}
	sort.Strings(warnings)
	return manifest, warnings, nil
}

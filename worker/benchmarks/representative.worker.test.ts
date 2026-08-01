import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
    FIXTURE_PROFILES,
    type FixtureValue,
    generateRepresentativeFixture,
    type RepresentativeFixture,
} from './fixture';
import {
    type MeasurementResult,
    planPasses,
    queryPlanSpecs,
    type ValidationCheck,
    type ValidationReport,
} from './validation';

const chunk = <A>(values: readonly A[], size: number): readonly A[][] => {
    const result: A[][] = [];
    for (let index = 0; index < values.length; index += size) {
        result.push(values.slice(index, index + size));
    }
    return result;
};

const bindValue = (
    value: FixtureValue,
): D1PreparedStatement['bind'] extends (...values: infer _A) => unknown
    ? FixtureValue
    : never => value;

const loadFixture = async (fixture: RepresentativeFixture): Promise<void> => {
    for (const [table, data] of Object.entries(fixture.tables)) {
        const placeholders = data.columns.map(() => '?').join(', ');
        const sql = `INSERT INTO ${table} (${data.columns.join(', ')}) VALUES (${placeholders})`;
        for (const rows of chunk(data.rows, 40)) {
            await env.DB.batch(
                rows.map((row) =>
                    env.DB.prepare(sql).bind(...row.map(bindValue)),
                ),
            );
        }
    }
};

const scalar = async (
    sql: string,
    bindings: readonly (string | number)[] = [],
): Promise<number> => {
    const row = await env.DB.prepare(sql)
        .bind(...bindings)
        .first<{ value: number }>();
    if (row === null || typeof row.value !== 'number') {
        throw new Error(`missing numeric value for: ${sql}`);
    }
    return row.value;
};

const check = (
    name: string,
    passed: boolean,
    detail: string,
): ValidationCheck => ({ name, passed, detail });

const effectiveRead =
    'COALESCE(ei.read_override, CASE WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1 ELSE 0 END)';

const measure = async (
    name: string,
    iterations: number,
    databaseOperations: number,
    operation: () => Promise<number>,
): Promise<MeasurementResult> => {
    const startedAt = performance.now();
    const rowsAffected = await operation();
    return {
        name,
        iterations,
        databaseOperations,
        rowsAffected,
        elapsedMs: performance.now() - startedAt,
    };
};

const readerMeasurement = async (
    fixture: RepresentativeFixture,
): Promise<MeasurementResult> => {
    const iterations = 5;
    const userId = fixture.semantics.primaryUserId;
    const from = `FROM entries e
        JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
        LEFT JOIN entry_interactions ei
            ON ei.user_id = fs.user_id AND ei.entry_id = e.id
        WHERE fs.user_id = ? AND ei.filtered_at IS NULL`;
    return measure(
        'reader.list_and_count',
        iterations,
        iterations * 2,
        async () => {
            let returned = 0;
            for (let iteration = 0; iteration < iterations; iteration += 1) {
                const results = await env.DB.batch([
                    env.DB.prepare(`SELECT COUNT(*) AS total ${from}`).bind(
                        userId,
                    ),
                    env.DB.prepare(
                        `SELECT e.id ${from}
                    ORDER BY e.published_at DESC, e.id DESC LIMIT 50 OFFSET ?`,
                    ).bind(userId, iteration * 10),
                ]);
                returned += results[0]?.results.length ?? 0;
                returned += results[1]?.results.length ?? 0;
            }
            return returned;
        },
    );
};

const readThroughMeasurement = async (
    fixture: RepresentativeFixture,
): Promise<MeasurementResult> => {
    const iterations = Math.min(5, fixture.config.feeds);
    const userId = fixture.semantics.primaryUserId;
    return measure(
        'reader.read_through_batch',
        iterations,
        iterations * 4,
        async () => {
            let changes = 0;
            for (let index = 0; index < iterations; index += 1) {
                const feedId = 10_000 + index;
                const now = fixture.generatedAt + 10_000 + index;
                const results = await env.DB.batch([
                    env.DB.prepare(
                        `UPDATE feed_subscriptions
                        SET read_through_entry_id = (
                            SELECT MAX(id) FROM entries WHERE feed_id = ?),
                            updated_at = ?
                        WHERE user_id = ? AND feed_id = ?`,
                    ).bind(feedId, now, userId, feedId),
                    env.DB.prepare(
                        `DELETE FROM entry_interactions
                        WHERE user_id = ? AND feed_id = ?
                            AND read_override IS NOT NULL
                            AND starred_at IS NULL AND archived_at IS NULL
                            AND filtered_at IS NULL
                            AND entry_id <= COALESCE((
                                SELECT read_through_entry_id
                                FROM feed_subscriptions
                                WHERE user_id = ? AND feed_id = ?), 0)`,
                    ).bind(userId, feedId, userId, feedId),
                    env.DB.prepare(
                        `UPDATE entry_interactions
                        SET read_override = NULL, read_changed_at = NULL,
                            updated_at = ?
                        WHERE user_id = ? AND feed_id = ?
                            AND read_override IS NOT NULL
                            AND entry_id <= COALESCE((
                                SELECT read_through_entry_id
                                FROM feed_subscriptions
                                WHERE user_id = ? AND feed_id = ?), 0)`,
                    ).bind(now, userId, feedId, userId, feedId),
                    env.DB.prepare(
                        `SELECT feed_id, read_through_entry_id
                        FROM feed_subscriptions
                        WHERE user_id = ? AND feed_id = ?`,
                    ).bind(userId, feedId),
                ]);
                changes += results.reduce(
                    (total, result) => total + (result.meta.changes ?? 0),
                    0,
                );
            }
            return changes;
        },
    );
};

const ingestionMeasurement = async (
    fixture: RepresentativeFixture,
): Promise<MeasurementResult> => {
    const iterations = 1;
    const entries = 8;
    const feedId = fixture.semantics.primaryFeedId;
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < entries; index += 1) {
        const id = 8_000_000 + index;
        const content = `<article><p>Deterministic ingestion batch ${id} ${'x'.repeat(1_024)}</p></article>`;
        statements.push(
            env.DB.prepare(
                `INSERT INTO entries (
                    id, feed_id, deduplication_key, source_id, title, url,
                    published_at, content_status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'stored', ?, ?)`,
            ).bind(
                id,
                feedId,
                new Uint8Array(32).fill(index + 1),
                `benchmark:${id}`,
                `Ingestion benchmark ${id}`,
                `https://benchmark.example.test/${id}`,
                fixture.generatedAt + index,
                fixture.generatedAt + index,
                fixture.generatedAt + index,
            ),
            env.DB.prepare(
                `INSERT INTO entry_contents (
                    entry_id, content_html, content_hash, encoded_size_bytes,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)`,
            ).bind(
                id,
                content,
                new Uint8Array(32).fill(index + 101),
                new TextEncoder().encode(content).byteLength,
                fixture.generatedAt + index,
                fixture.generatedAt + index,
            ),
        );
    }
    return measure(
        'feed.ingestion_batch',
        iterations,
        statements.length,
        async () => {
            const results = await env.DB.batch(statements);
            return results.reduce(
                (total, result) => total + (result.meta.changes ?? 0),
                0,
            );
        },
    );
};

describe('production-shaped D1 validation', () => {
    it('validates integrity, semantics, plans, and bounded operation metadata', async () => {
        const fixture = await generateRepresentativeFixture(
            FIXTURE_PROFILES[env.D1_VALIDATION_PROFILE],
        );
        await loadFixture(fixture);
        await env.DB.exec('ANALYZE');

        const checks: ValidationCheck[] = [];
        const foreignKeys = await env.DB.prepare(
            'PRAGMA foreign_key_check',
        ).all();
        checks.push(
            check(
                'foreign_keys',
                foreignKeys.results.length === 0,
                `${foreignKeys.results.length} violations`,
            ),
        );

        const rowCounts: Record<string, number> = {};
        for (const [table, expected] of Object.entries(
            fixture.expectedCounts,
        )) {
            const actual = await scalar(
                `SELECT COUNT(*) AS value FROM ${table}`,
            );
            rowCounts[table] = actual;
            checks.push(
                check(
                    `row_count.${table}`,
                    actual === expected,
                    `expected=${expected} actual=${actual}`,
                ),
            );
        }

        const idTables = [
            'users',
            'feeds',
            'entries',
            'subscription_categories',
            'jobs',
            'outbox_messages',
            'feed_refreshes',
            'entry_summaries',
            'opml_imports',
            'opml_import_items',
        ];
        let unsafeIds = 0;
        for (const table of idTables) {
            unsafeIds += await scalar(
                `SELECT COUNT(*) AS value FROM ${table}
                 WHERE id < 1 OR id > 9007199254740991`,
            );
        }
        checks.push(
            check('safe_ids', unsafeIds === 0, `${unsafeIds} unsafe IDs`),
        );

        const ownershipViolations = await scalar(
            `SELECT COUNT(*) AS value FROM (
                SELECT fs.user_id, fs.feed_id
                FROM feed_subscriptions fs
                LEFT JOIN subscription_categories sc
                    ON sc.user_id = fs.user_id AND sc.id = fs.category_id
                WHERE sc.id IS NULL
                UNION ALL
                SELECT ei.user_id, ei.entry_id
                FROM entry_interactions ei
                LEFT JOIN feed_subscriptions fs
                    ON fs.user_id = ei.user_id AND fs.feed_id = ei.feed_id
                LEFT JOIN entries e
                    ON e.feed_id = ei.feed_id AND e.id = ei.entry_id
                WHERE fs.user_id IS NULL OR e.id IS NULL)`,
        );
        checks.push(
            check(
                'ownership_invariants',
                ownershipViolations === 0,
                `${ownershipViolations} violations`,
            ),
        );

        const contentViolations = await scalar(
            `SELECT COUNT(*) AS value FROM entries e
             LEFT JOIN entry_contents ec ON ec.entry_id = e.id
             WHERE (e.content_status = 'stored' AND ec.entry_id IS NULL)
                OR (e.content_status <> 'stored' AND ec.entry_id IS NOT NULL)
                OR ec.encoded_size_bytes > 1800000
                OR (ec.entry_id IS NOT NULL
                    AND ec.encoded_size_bytes <> length(CAST(ec.content_html AS BLOB)))
                OR (ec.entry_id IS NOT NULL AND length(ec.content_hash) <> 32)`,
        );
        const nearLimitBytes = await scalar(
            `SELECT encoded_size_bytes AS value FROM entry_contents
             WHERE entry_id = ?`,
            [fixture.semantics.nearLimitEntryId],
        );
        const oversizedContentRows = await scalar(
            `SELECT COUNT(*) AS value FROM entry_contents WHERE entry_id = ?`,
            [fixture.semantics.oversizedEntryId],
        );
        checks.push(
            check(
                'content_split_and_caps',
                contentViolations === 0 &&
                    nearLimitBytes >= 1_790_000 &&
                    nearLimitBytes <= 1_800_000 &&
                    oversizedContentRows === 0,
                `violations=${contentViolations} near_limit_bytes=${nearLimitBytes} oversized_source_bytes=${fixture.semantics.oversizedSourceBytes}`,
            ),
        );
        const summaryHashViolations = await scalar(
            `SELECT COUNT(*) AS value FROM entry_summaries es
             JOIN entry_contents ec ON ec.entry_id = es.entry_id
             WHERE es.content_hash <> ec.content_hash`,
        );
        checks.push(
            check(
                'summary_content_hash_consistency',
                summaryHashViolations === 0,
                `${summaryHashViolations} mismatches`,
            ),
        );

        const logicalUserEntries = await scalar(
            `SELECT SUM(entry_count) AS value FROM (
                SELECT fs.user_id, fs.feed_id, COUNT(e.id) AS entry_count
                FROM feed_subscriptions fs
                JOIN entries e ON e.feed_id = fs.feed_id
                GROUP BY fs.user_id, fs.feed_id)`,
        );
        const interactionRows = rowCounts.entry_interactions ?? 0;
        const amplificationRatio = interactionRows / logicalUserEntries;
        checks.push(
            check(
                'sparse_interaction_amplification',
                amplificationRatio < 0.2,
                `${interactionRows}/${logicalUserEntries}=${amplificationRatio.toFixed(6)}`,
            ),
        );

        const semantics = fixture.semantics;
        const equalTimestampRows = await env.DB.prepare(
            `SELECT id FROM entries WHERE id IN (?, ?)
             ORDER BY published_at DESC, id DESC`,
        )
            .bind(...semantics.equalTimestampEntryIds)
            .all<{ id: number }>();
        checks.push(
            check(
                'equal_timestamp_tiebreaker',
                equalTimestampRows.results.map(({ id }) => id).join(',') ===
                    [...semantics.equalTimestampEntryIds].reverse().join(','),
                equalTimestampRows.results.map(({ id }) => id).join(','),
            ),
        );

        const stateRows = await env.DB.prepare(
            `SELECT e.id, ${effectiveRead} AS is_read,
                ei.starred_at IS NOT NULL AS is_starred,
                ei.archived_at IS NOT NULL AS is_archived,
                ei.filtered_at IS NOT NULL AS is_filtered
             FROM entries e
             JOIN feed_subscriptions fs
                ON fs.feed_id = e.feed_id AND fs.user_id = ?
             LEFT JOIN entry_interactions ei
                ON ei.user_id = fs.user_id AND ei.entry_id = e.id
             WHERE e.id IN (?, ?, ?, ?, ?)`,
        )
            .bind(
                semantics.primaryUserId,
                semantics.lateOldEntryId,
                semantics.explicitUnreadEntryId,
                semantics.explicitReadEntryId,
                semantics.starredEntryId,
                semantics.archivedEntryId,
            )
            .all<{
                id: number;
                is_read: number;
                is_starred: number;
                is_archived: number;
                is_filtered: number;
            }>();
        const states = new Map(stateRows.results.map((row) => [row.id, row]));
        const semanticStatesPass =
            states.get(semantics.lateOldEntryId)?.is_read === 0 &&
            states.get(semantics.explicitUnreadEntryId)?.is_read === 0 &&
            states.get(semantics.explicitReadEntryId)?.is_read === 1 &&
            states.get(semantics.starredEntryId)?.is_starred === 1 &&
            states.get(semantics.archivedEntryId)?.is_archived === 1;
        checks.push(
            check(
                'watermark_sparse_states',
                semanticStatesPass,
                `late_old=${states.get(semantics.lateOldEntryId)?.is_read} explicit_unread=${states.get(semantics.explicitUnreadEntryId)?.is_read} explicit_read=${states.get(semantics.explicitReadEntryId)?.is_read}`,
            ),
        );
        const filteredVisible = await scalar(
            `SELECT COUNT(*) AS value FROM entries e
             JOIN feed_subscriptions fs
                ON fs.feed_id = e.feed_id AND fs.user_id = ?
             LEFT JOIN entry_interactions ei
                ON ei.user_id = fs.user_id AND ei.entry_id = e.id
             WHERE e.id = ? AND ei.filtered_at IS NULL`,
            [semantics.primaryUserId, semantics.filteredEntryId],
        );
        checks.push(
            check(
                'filtered_visibility',
                filteredVisible === 0,
                `${filteredVisible} visible rows`,
            ),
        );

        const categoryViolations = await scalar(
            `SELECT COUNT(*) AS value FROM feed_subscriptions fs
             JOIN subscription_categories sc ON sc.id = fs.category_id
             WHERE fs.user_id <> sc.user_id`,
        );
        checks.push(
            check(
                'subscription_category_mapping',
                categoryViolations === 0,
                `${categoryViolations} cross-owner mappings`,
            ),
        );

        const plans = [];
        const queryResults = new Map<
            string,
            readonly Record<string, unknown>[]
        >();
        for (const spec of queryPlanSpecs(fixture)) {
            const result = await env.DB.prepare(
                `EXPLAIN QUERY PLAN ${spec.sql}`,
            )
                .bind(...spec.bindings)
                .all<{ detail: string }>();
            const details = result.results.map(({ detail }) => detail);
            plans.push({
                name: spec.name,
                details,
                required: spec.required,
                passed: planPasses(details, spec.required),
            });
            const queryResult = await env.DB.prepare(spec.sql)
                .bind(...spec.bindings)
                .all<Record<string, unknown>>();
            queryResults.set(spec.name, queryResult.results);
        }
        const firstId = (name: string): number | undefined => {
            const id = queryResults.get(name)?.[0]?.id;
            return typeof id === 'number' ? id : undefined;
        };
        const lastFeedIndex = fixture.config.feeds - 1;
        const lastCategoryFeedIndex = lastFeedIndex - (lastFeedIndex % 3);
        const watermarkIndex =
            Math.floor(fixture.config.entriesPerFeed / 2) - 1;
        const expectedFirstIds: Readonly<Record<string, number>> = {
            'reader.global':
                1_000_000 + lastFeedIndex * fixture.config.entriesPerFeed + 2,
            'reader.feed': 1_000_002,
            'reader.category':
                1_000_000 +
                lastCategoryFeedIndex * fixture.config.entriesPerFeed +
                2,
            'reader.unread':
                1_000_000 + lastFeedIndex * fixture.config.entriesPerFeed + 1,
            'reader.favorites':
                1_000_000 +
                lastFeedIndex * fixture.config.entriesPerFeed +
                watermarkIndex +
                2,
            'reader.detail': fixture.semantics.lateOldEntryId,
            'refresh.due': 10_000,
            'outbox.lease': 3_000_000,
            'history.cleanup': 4_000_000,
        };
        for (const [name, expectedId] of Object.entries(expectedFirstIds)) {
            const actualId = firstId(name);
            checks.push(
                check(
                    `query_result.${name}`,
                    actualId === expectedId,
                    `expected_first_id=${expectedId} actual_first_id=${String(actualId)}`,
                ),
            );
        }
        const detailContent =
            queryResults.get('reader.detail')?.[0]?.content_html;
        checks.push(
            check(
                'query_result.reader.detail_content',
                typeof detailContent === 'string' && detailContent.length > 0,
                `content_length=${typeof detailContent === 'string' ? detailContent.length : 0}`,
            ),
        );

        const measurements = [
            await readerMeasurement(fixture),
            await readThroughMeasurement(fixture),
            await ingestionMeasurement(fixture),
        ];
        const measuredPayloadBytes = await scalar(
            `SELECT CAST(
                COALESCE((SELECT SUM(encoded_size_bytes) FROM entry_contents), 0)
                + COALESCE((SELECT SUM(
                    length(title) + COALESCE(length(url), 0)
                    + COALESCE(length(author), 0)
                    + COALESCE(length(source_id), 0)
                    + length(deduplication_key)) FROM entries), 0)
                + COALESCE((SELECT SUM(
                    length(name) + length(feed_url)
                    + COALESCE(length(site_url), 0)
                    + COALESCE(length(favicon_url), 0)) FROM feeds), 0)
                + COALESCE((SELECT SUM(length(summary_html))
                    FROM entry_summaries), 0)
                AS INTEGER) AS value`,
        );
        const entryCount = await scalar(
            'SELECT COUNT(*) AS value FROM entries',
        );
        const totalRows =
            Object.values(rowCounts).reduce(
                (total, count) => total + count,
                0,
            ) + 16;
        const assumedRowOverheadBytes = totalRows * 128;
        const estimatedBytes = measuredPayloadBytes + assumedRowOverheadBytes;
        const report: ValidationReport = {
            schemaVersion: 1,
            generatedAt: new Date(fixture.generatedAt).toISOString(),
            fixture: fixture.config,
            rowCounts,
            databaseSize: {
                method: 'payload_plus_row_overhead',
                measuredPayloadBytes,
                assumedRowOverheadBytes,
                estimatedBytes,
                bytesPerEntry: estimatedBytes / entryCount,
            },
            sparseInteractions: {
                interactionRows,
                logicalUserEntries,
                amplificationRatio,
            },
            checks,
            plans,
            measurements,
            passed:
                checks.every(({ passed }) => passed) &&
                plans.every(({ passed }) => passed),
        };

        console.log(`LARAFEED_D1_VALIDATION_REPORT=${JSON.stringify(report)}`);
        expect(
            checks.filter(({ passed }) => !passed),
            'integrity and semantic checks',
        ).toEqual([]);
        expect(
            plans.filter(({ passed }) => !passed),
            `query plans: ${JSON.stringify(plans, null, 2)}`,
        ).toEqual([]);
        expect(report.passed).toBe(true);
        expect(
            measurements.map(({ databaseOperations }) => databaseOperations),
        ).toEqual([10, Math.min(5, fixture.config.feeds) * 4, 16]);
    }, 60_000);
});

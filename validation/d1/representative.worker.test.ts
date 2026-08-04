import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
    FIXTURE_PROFILES,
    type FixtureValue,
    generateRepresentativeFixture,
    type RepresentativeFixture,
} from './fixture';
import {
    planUsesRequiredIndexes,
    queryPlanSpecs,
} from './query-plans';

interface ValidationCheck {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
}

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

describe('production-shaped D1 validation', () => {
    it('validates integrity, semantics, and query plans', async () => {
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
                passed: planUsesRequiredIndexes(details, spec.required),
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

        expect(
            checks.filter(({ passed }) => !passed),
            'integrity and semantic checks',
        ).toEqual([]);
        expect(
            plans.filter(({ passed }) => !passed),
            `query plans: ${JSON.stringify(plans, null, 2)}`,
        ).toEqual([]);
    }, 60_000);
});

import type { RepresentativeFixture } from './fixture';

export interface QueryPlanSpec {
    readonly name: string;
    readonly sql: string;
    readonly bindings: readonly (string | number)[];
    readonly required: readonly string[];
}

export interface PlanResult {
    readonly name: string;
    readonly details: readonly string[];
    readonly required: readonly string[];
    readonly passed: boolean;
}

export interface MeasurementResult {
    readonly name: string;
    readonly iterations: number;
    readonly databaseOperations: number;
    readonly rowsAffected: number;
    readonly elapsedMs: number;
}

export interface ValidationCheck {
    readonly name: string;
    readonly passed: boolean;
    readonly detail: string;
}

export interface ValidationReport {
    readonly schemaVersion: 1;
    readonly generatedAt: string;
    readonly fixture: RepresentativeFixture['config'];
    readonly rowCounts: Readonly<Record<string, number>>;
    readonly databaseSize: {
        readonly method: 'payload_plus_row_overhead';
        readonly measuredPayloadBytes: number;
        readonly assumedRowOverheadBytes: number;
        readonly estimatedBytes: number;
        readonly bytesPerEntry: number;
    };
    readonly sparseInteractions: {
        readonly interactionRows: number;
        readonly logicalUserEntries: number;
        readonly amplificationRatio: number;
    };
    readonly checks: readonly ValidationCheck[];
    readonly plans: readonly PlanResult[];
    readonly measurements: readonly MeasurementResult[];
    readonly passed: boolean;
}

const effectiveRead =
    'COALESCE(ei.read_override, CASE WHEN fs.read_through_entry_id IS NOT NULL AND e.id <= fs.read_through_entry_id THEN 1 ELSE 0 END)';

export const queryPlanSpecs = (
    fixture: RepresentativeFixture,
): readonly QueryPlanSpec[] => {
    const { primaryUserId, primaryFeedId, primaryCategoryId, lateOldEntryId } =
        fixture.semantics;
    return [
        {
            name: 'reader.global',
            sql: `SELECT e.id FROM entries e
                JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                LEFT JOIN entry_interactions ei
                    ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE fs.user_id = ? AND ei.filtered_at IS NULL
                ORDER BY e.published_at DESC, e.id DESC LIMIT 20`,
            bindings: [primaryUserId],
            required: [
                'feed_subscriptions_user_category',
                'entries_feed_published',
            ],
        },
        {
            name: 'reader.feed',
            sql: `SELECT e.id FROM entries e
                JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                LEFT JOIN entry_interactions ei
                    ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE fs.user_id = ? AND e.feed_id = ?
                    AND ei.filtered_at IS NULL
                ORDER BY e.published_at DESC, e.id DESC LIMIT 20`,
            bindings: [primaryUserId, primaryFeedId],
            required: ['entries_feed_published'],
        },
        {
            name: 'reader.category',
            sql: `SELECT e.id FROM feed_subscriptions fs
                JOIN entries e ON e.feed_id = fs.feed_id
                LEFT JOIN entry_interactions ei
                    ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE fs.user_id = ? AND fs.category_id = ?
                    AND ei.filtered_at IS NULL
                ORDER BY e.published_at DESC, e.id DESC LIMIT 20`,
            bindings: [primaryUserId, primaryCategoryId],
            required: [
                'feed_subscriptions_user_category',
                'entries_feed_published',
            ],
        },
        {
            name: 'reader.unread',
            sql: `SELECT e.id FROM entries e
                JOIN feed_subscriptions fs ON fs.feed_id = e.feed_id
                LEFT JOIN entry_interactions ei
                    ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                WHERE fs.user_id = ? AND ei.filtered_at IS NULL
                    AND ${effectiveRead} = 0
                ORDER BY e.published_at DESC, e.id DESC LIMIT 20`,
            bindings: [primaryUserId],
            required: [
                'feed_subscriptions_user_category',
                'entries_feed_published',
            ],
        },
        {
            name: 'reader.favorites',
            sql: `SELECT e.id FROM entry_interactions ei
                JOIN entries e ON e.id = ei.entry_id
                JOIN feed_subscriptions fs
                    ON fs.user_id = ei.user_id AND fs.feed_id = ei.feed_id
                WHERE ei.user_id = ? AND ei.starred_at IS NOT NULL
                    AND ei.filtered_at IS NULL
                ORDER BY ei.starred_at DESC, ei.entry_id DESC LIMIT 20`,
            bindings: [primaryUserId],
            required: ['entry_interactions_starred'],
        },
        {
            name: 'reader.detail',
            sql: `SELECT e.id, ec.content_html FROM entries e
                JOIN feed_subscriptions fs
                    ON fs.feed_id = e.feed_id AND fs.user_id = ?
                LEFT JOIN entry_interactions ei
                    ON ei.user_id = fs.user_id AND ei.entry_id = e.id
                LEFT JOIN entry_contents ec ON ec.entry_id = e.id
                WHERE e.id = ? AND ei.filtered_at IS NULL`,
            bindings: [primaryUserId, lateOldEntryId],
            required: ['INTEGER PRIMARY KEY'],
        },
        {
            name: 'refresh.due',
            sql: `SELECT id, next_refresh_at FROM feeds
                WHERE is_gone = 0 AND next_refresh_at <= ?
                ORDER BY next_refresh_at, id LIMIT 10`,
            bindings: [fixture.generatedAt],
            required: ['feeds_due_refresh'],
        },
        {
            name: 'outbox.lease',
            sql: `SELECT id FROM outbox_messages
                WHERE state = 'pending' AND available_at <= ?
                ORDER BY available_at, id LIMIT 10`,
            bindings: [fixture.generatedAt],
            required: ['outbox_messages_pending'],
        },
        {
            name: 'history.cleanup',
            sql: `SELECT old.id FROM feed_refreshes old
                WHERE old.refreshed_at < ?
                    AND EXISTS (
                        SELECT 1 FROM feed_refreshes newer
                        WHERE newer.feed_id = old.feed_id
                            AND (newer.refreshed_at > old.refreshed_at
                                OR (newer.refreshed_at = old.refreshed_at
                                    AND newer.id > old.id)))
                ORDER BY old.refreshed_at, old.id LIMIT 100`,
            bindings: [fixture.generatedAt - 90 * 86_400_000],
            required: ['feed_refreshes_time', 'feed_refreshes_feed_time'],
        },
    ];
};

export const planPasses = (
    details: readonly string[],
    required: readonly string[],
): boolean => {
    const joined = details.join('\n');
    return required.every((index) => joined.includes(index));
};

const status = (passed: boolean): string => (passed ? 'PASS' : 'FAIL');
const table = (headers: readonly string[], rows: readonly string[][]): string =>
    [
        `| ${headers.join(' | ')} |`,
        `| ${headers.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.join(' | ')} |`),
    ].join('\n');

export const renderMarkdownReport = (
    report: ValidationReport,
): string => `# Larafeed D1 representative validation

**Result:** ${status(report.passed)}

**Generated:** ${report.generatedAt}

**Fixture:** ${report.fixture.profile} (${report.fixture.users} users, ${report.fixture.feeds} feeds, ${report.fixture.entriesPerFeed} entries/feed)

## Integrity and semantics

${table(
    ['Check', 'Result', 'Detail'],
    report.checks.map((check) => [
        check.name,
        status(check.passed),
        check.detail.replaceAll('|', '\\|'),
    ]),
)}

## Query plans

${table(
    ['Query', 'Result', 'Required indexes'],
    report.plans.map((plan) => [
        plan.name,
        status(plan.passed),
        plan.required.join(', '),
    ]),
)}

## Measurements

Elapsed times are metadata only. Validation has no latency threshold.

${table(
    ['Operation', 'Iterations', 'DB operations', 'Rows affected', 'Elapsed ms'],
    report.measurements.map((measurement) => [
        measurement.name,
        String(measurement.iterations),
        String(measurement.databaseOperations),
        String(measurement.rowsAffected),
        measurement.elapsedMs.toFixed(3),
    ]),
)}

## Capacity indicators

- Estimate method: ${report.databaseSize.method}
- Measured payload bytes: ${report.databaseSize.measuredPayloadBytes}
- Assumed row overhead bytes: ${report.databaseSize.assumedRowOverheadBytes}
- Estimated D1 bytes: ${report.databaseSize.estimatedBytes}
- Estimated bytes per entry: ${report.databaseSize.bytesPerEntry.toFixed(2)}
- Sparse interaction rows: ${report.sparseInteractions.interactionRows}
- Logical user-entry rows: ${report.sparseInteractions.logicalUserEntries}
- Sparse amplification ratio: ${report.sparseInteractions.amplificationRatio.toFixed(6)}

## Row counts

${table(
    ['Table', 'Rows'],
    Object.entries(report.rowCounts).map(([name, count]) => [
        name,
        String(count),
    ]),
)}
`;

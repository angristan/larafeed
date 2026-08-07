import type { RepresentativeFixture } from './fixture';

export interface QueryPlanSpec {
    readonly name: string;
    readonly sql: string;
    readonly bindings: readonly (string | number)[];
    readonly required: readonly string[];
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
            required: ['feed_subscriptions', 'entries_feed_published'],
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
            name: 'refresh.reconcile',
            sql: `SELECT o.id
                FROM jobs j INDEXED BY jobs_feed_refresh_reconcile
                JOIN outbox_messages o ON o.job_id = j.id
                WHERE j.kind = 'feed_refresh'
                    AND j.state IN ('queued', 'failed')
                    AND j.updated_at <= ? AND j.available_at <= ?
                    AND o.topic = 'feed-refresh' AND o.state = 'sent'
                    AND o.updated_at <= ?
                ORDER BY j.updated_at, j.id LIMIT 10`,
            bindings: [
                fixture.generatedAt,
                fixture.generatedAt,
                fixture.generatedAt,
            ],
            required: [
                'jobs_feed_refresh_reconcile',
                'sqlite_autoindex_outbox_messages_1',
            ],
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

export const planUsesRequiredIndexes = (
    details: readonly string[],
    required: readonly string[],
): boolean => {
    const joined = details.join('\n');
    return required.every((index) => joined.includes(index));
};

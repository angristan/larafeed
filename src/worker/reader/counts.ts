/**
 * SQL for a subscription's visible and unread entry counts that does not
 * read the feed's entries.
 *
 * An entry is unread when its ID is above the subscription's
 * read_through_entry_id, unless an entry_interactions row overrides it.
 * Filtered entries are hidden and count as neither. Migration 0029 stores
 * how many entries a feed has (feeds.entry_count) and how many are at or
 * below the watermark (feed_subscriptions.read_through_count). The counts
 * start from those and correct them with the subscription's
 * entry_interactions rows, which are sparse: an override, a star, an
 * archive, or a filter.
 *
 * The fragments expect `fs` (feed_subscriptions), `f` (its feed) and `ci`,
 * joined with `countInteractionsJoin`, grouped by subscription.
 */

const watermark = 'COALESCE(fs.read_through_entry_id, 0)';

export const countInteractionsJoin = `LEFT JOIN entry_interactions ci
    ON ci.user_id = fs.user_id AND ci.feed_id = fs.feed_id`;

export const subscriptionTotalCount = `f.entry_count - COALESCE(SUM(
    CASE WHEN ci.filtered_at IS NOT NULL THEN 1 ELSE 0 END), 0)`;

// Each interaction row moves the count from what the watermark alone says
// (unread when above it) to the entry's real state (unread when visible
// and not read).
export const subscriptionUnreadCount = `f.entry_count - fs.read_through_count
    + COALESCE(SUM(CASE WHEN ci.entry_id IS NULL THEN 0 ELSE
        (CASE WHEN ci.filtered_at IS NULL
            AND COALESCE(ci.read_override, ci.entry_id <= ${watermark}) = 0
            THEN 1 ELSE 0 END)
        - (CASE WHEN ci.entry_id > ${watermark} THEN 1 ELSE 0 END)
    END), 0)`;

/**
 * One row per subscription matching `where` (over `fs`), with
 * `total_count` and `unread_count`.
 */
export const subscriptionCountsSql = (where: string) => `SELECT
    fs.user_id, fs.feed_id, fs.category_id,
    ${subscriptionTotalCount} AS total_count,
    ${subscriptionUnreadCount} AS unread_count
FROM feed_subscriptions fs
JOIN feeds f ON f.id = fs.feed_id
${countInteractionsJoin}
WHERE ${where}
GROUP BY fs.user_id, fs.feed_id`;

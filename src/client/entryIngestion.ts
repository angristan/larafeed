// The refocus probe asks "was anything ingested after everything cached?".
// It compares by ingestion time (created_at) rather than the visible sort:
// under published_at, a backfilled article — published before the current
// top entry but ingested late — never changes the top row and a
// top-of-list comparison would miss it. Ids break ties for entries
// ingested in the same millisecond.

export interface IngestionMark {
    readonly id: number;
    readonly createdAt: number;
}

export function isNewerIngestion(
    fresh: IngestionMark,
    latest: IngestionMark,
): boolean {
    return (
        fresh.createdAt > latest.createdAt ||
        (fresh.createdAt === latest.createdAt && fresh.id > latest.id)
    );
}

export function countNewIngestions(
    cachedTotal: number | undefined,
    freshTotal: number,
): number {
    if (cachedTotal === undefined) return 1;

    // Reader interactions can shrink a filtered server total while retained
    // pages intentionally stay stable. A newer ingestion still means at least
    // one entry is waiting even when the raw total delta is zero or negative.
    return Math.max(1, freshTotal - cachedTotal);
}

export function latestIngestion<T extends IngestionMark>(
    entries: readonly T[],
): T | undefined {
    let latest: T | undefined;
    for (const entry of entries) {
        if (latest === undefined || isNewerIngestion(entry, latest)) {
            latest = entry;
        }
    }
    return latest;
}

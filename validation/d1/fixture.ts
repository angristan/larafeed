export type FixtureProfileName = 'ci' | 'large';

export interface FixtureConfig {
    readonly profile: FixtureProfileName;
    readonly users: number;
    readonly feeds: number;
    readonly entriesPerFeed: number;
    readonly normalContentBytes: number;
}

export type FixtureValue = null | string | number | Uint8Array;

export interface FixtureTable {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly FixtureValue[])[];
}

export interface FixtureSemantics {
    readonly primaryUserId: number;
    readonly primaryFeedId: number;
    readonly primaryCategoryId: number;
    readonly equalTimestampEntryIds: readonly [number, number];
    readonly lateOldEntryId: number;
    readonly explicitUnreadEntryId: number;
    readonly explicitReadEntryId: number;
    readonly filteredEntryId: number;
    readonly starredEntryId: number;
    readonly archivedEntryId: number;
    readonly nearLimitEntryId: number;
    readonly oversizedEntryId: number;
    readonly oversizedSourceBytes: number;
}

export interface RepresentativeFixture {
    readonly config: FixtureConfig;
    readonly generatedAt: number;
    readonly tables: Readonly<Record<string, FixtureTable>>;
    readonly expectedCounts: Readonly<Record<string, number>>;
    readonly semantics: FixtureSemantics;
}

export const FIXTURE_NOW = 1_735_689_600_000;
export const MAX_STORED_CONTENT_BYTES = 1_800_000;

export const FIXTURE_PROFILES: Readonly<
    Record<FixtureProfileName, FixtureConfig>
> = {
    ci: {
        profile: 'ci',
        users: 2,
        feeds: 8,
        entriesPerFeed: 32,
        normalContentBytes: 2_048,
    },
    large: {
        profile: 'large',
        users: 4,
        feeds: 60,
        entriesPerFeed: 200,
        normalContentBytes: 8_192,
    },
};

const TABLE_COLUMNS = {
    users: [
        'id',
        'webauthn_user_handle',
        'username',
        'email',
        'display_name',
        'is_admin',
        'created_at',
        'updated_at',
    ],
    feeds: [
        'id',
        'name',
        'feed_url',
        'site_url',
        'favicon_url',
        'favicon_is_dark',
        'etag',
        'last_modified',
        'is_gone',
        'consecutive_failures',
        'last_attempt_at',
        'last_successful_refresh_at',
        'latest_entry_at',
        'next_refresh_at',
        'created_at',
        'updated_at',
    ],
    entries: [
        'id',
        'feed_id',
        'deduplication_key',
        'source_id',
        'title',
        'url',
        'author',
        'published_at',
        'source_updated_at',
        'content_status',
        'created_at',
        'updated_at',
    ],
    entry_contents: [
        'entry_id',
        'content_html',
        'content_hash',
        'encoded_size_bytes',
        'created_at',
        'updated_at',
    ],
    subscription_categories: [
        'id',
        'user_id',
        'name',
        'created_at',
        'updated_at',
    ],
    feed_subscriptions: [
        'user_id',
        'feed_id',
        'category_id',
        'custom_feed_name',
        'filter_rules_json',
        'read_through_entry_id',
        'created_at',
        'updated_at',
    ],
    entry_interactions: [
        'user_id',
        'feed_id',
        'entry_id',
        'read_override',
        'read_changed_at',
        'starred_at',
        'archived_at',
        'filtered_at',
        'created_at',
        'updated_at',
    ],
    jobs: [
        'id',
        'operation_id',
        'kind',
        'state',
        'payload_json',
        'attempt_count',
        'max_attempts',
        'available_at',
        'lease_owner',
        'lease_expires_at',
        'started_at',
        'completed_at',
        'created_at',
        'updated_at',
    ],
    outbox_messages: [
        'id',
        'job_id',
        'topic',
        'payload_json',
        'state',
        'attempt_count',
        'available_at',
        'lease_owner',
        'lease_expires_at',
        'sent_at',
        'created_at',
        'updated_at',
    ],
    feed_refreshes: [
        'id',
        'feed_id',
        'job_id',
        'refreshed_at',
        'was_successful',
        'was_not_modified',
        'http_status',
        'entries_seen',
        'entries_created',
        'entries_updated',
        'duration_ms',
        'created_at',
    ],
    entry_summaries: [
        'id',
        'entry_id',
        'requested_by_user_id',
        'job_id',
        'content_hash',
        'model',
        'prompt_version',
        'summary_html',
        'created_at',
        'updated_at',
    ],
    opml_imports: [
        'id',
        'user_id',
        'source_filename',
        'state',
        'total_items',
        'succeeded_items',
        'failed_items',
        'skipped_items',
        'started_at',
        'completed_at',
        'created_at',
        'updated_at',
    ],
    opml_import_items: [
        'id',
        'import_id',
        'user_id',
        'position',
        'operation_id',
        'job_id',
        'title',
        'feed_url',
        'normalized_feed_url',
        'site_url',
        'category_path_json',
        'state',
        'attempt_count',
        'max_attempts',
        'feed_id',
        'category_id',
        'started_at',
        'completed_at',
        'created_at',
        'updated_at',
    ],
} as const;

const bytes = (seed: number): Uint8Array => {
    const result = new Uint8Array(32);
    for (let index = 0; index < result.length; index += 1) {
        result[index] = (seed * 31 + index * 17 + 1) % 256;
    }
    return result;
};

const sha256 = async (value: string): Promise<Uint8Array> =>
    new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    );

const article = (entryId: number, minimumBytes: number): string => {
    const heading = `<article><h1>Migration article ${entryId}</h1><p lang="fr">café</p>`;
    const paragraph = `<p>Larafeed keeps complete article text, links, punctuation, and metadata for deterministic reader validation ${entryId}.</p>`;
    const closing = '</article>';
    let content = heading;
    while (content.length + closing.length < minimumBytes) content += paragraph;
    return content + closing;
};

const integer = (name: string, value: number, minimum: number): number => {
    if (!Number.isSafeInteger(value) || value < minimum) {
        throw new Error(`${name} must be a safe integer >= ${minimum}`);
    }
    return value;
};

export const resolveFixtureConfig = (
    profile: FixtureProfileName = 'ci',
    overrides: Partial<Omit<FixtureConfig, 'profile'>> = {},
): FixtureConfig => {
    const base = FIXTURE_PROFILES[profile];
    return {
        profile,
        users: integer('users', overrides.users ?? base.users, 1),
        feeds: integer('feeds', overrides.feeds ?? base.feeds, 1),
        entriesPerFeed: integer(
            'entriesPerFeed',
            overrides.entriesPerFeed ?? base.entriesPerFeed,
            12,
        ),
        normalContentBytes: integer(
            'normalContentBytes',
            overrides.normalContentBytes ?? base.normalContentBytes,
            256,
        ),
    };
};

interface MutableInteraction {
    readOverride: number | null;
    readChangedAt: number | null;
    starredAt: number | null;
    archivedAt: number | null;
    filteredAt: number | null;
}

export const generateRepresentativeFixture = async (
    config: FixtureConfig = FIXTURE_PROFILES.ci,
): Promise<RepresentativeFixture> => {
    const checked = resolveFixtureConfig(config.profile, config);
    const rows: Record<string, FixtureValue[][]> = Object.fromEntries(
        Object.keys(TABLE_COLUMNS).map((table) => [table, []]),
    );
    const entryHashes = new Map<number, Uint8Array>();
    const entryId = (feedIndex: number, index: number) =>
        1_000_000 + feedIndex * checked.entriesPerFeed + index;
    const userId = (index: number) => 1_000 + index;
    const feedId = (index: number) => 10_000 + index;
    const categoryId = (userIndex: number, categoryIndex: number) =>
        100_000 + userIndex * 10 + categoryIndex;
    const watermarkIndex = Math.floor(checked.entriesPerFeed / 2) - 1;

    for (let userIndex = 0; userIndex < checked.users; userIndex += 1) {
        const id = userId(userIndex);
        rows.users.push([
            id,
            bytes(id),
            `reader-${id}`,
            `reader-${id}@example.test`,
            `Reader ${userIndex + 1}`,
            userIndex === 0 ? 1 : 0,
            FIXTURE_NOW - 86_400_000,
            FIXTURE_NOW,
        ]);
        for (let categoryIndex = 0; categoryIndex < 3; categoryIndex += 1) {
            rows.subscription_categories.push([
                categoryId(userIndex, categoryIndex),
                id,
                ['Engineering', 'Research', 'News'][categoryIndex] ?? 'Other',
                FIXTURE_NOW - 86_400_000,
                FIXTURE_NOW,
            ]);
        }
    }

    for (let feedIndex = 0; feedIndex < checked.feeds; feedIndex += 1) {
        const id = feedId(feedIndex);
        const dueAt = FIXTURE_NOW + (feedIndex % 3 === 0 ? -60_000 : 3_600_000);
        rows.feeds.push([
            id,
            `Production-shaped Feed ${feedIndex + 1}`,
            `https://feeds${feedIndex % 5}.example.test/${id}.xml`,
            `https://sites${feedIndex % 5}.example.test/${id}/`,
            `https://sites${feedIndex % 5}.example.test/${id}/favicon.ico`,
            feedIndex % 2,
            `W/"fixture-${id}"`,
            'Wed, 01 Jan 2025 00:00:00 GMT',
            0,
            feedIndex % 7 === 0 ? 1 : 0,
            FIXTURE_NOW - 60_000,
            FIXTURE_NOW - 3_600_000,
            FIXTURE_NOW - 60_000,
            dueAt,
            FIXTURE_NOW - 31_536_000_000,
            FIXTURE_NOW,
        ]);

        for (let index = 0; index < checked.entriesPerFeed; index += 1) {
            const id = entryId(feedIndex, index);
            const ordinal = feedIndex * checked.entriesPerFeed + index;
            const isNearLimit = ordinal === 0;
            const isOversized = ordinal === 1;
            const isEmpty = !isNearLimit && !isOversized && ordinal % 13 === 0;
            const contentStatus = isOversized
                ? 'oversized'
                : isEmpty
                  ? 'empty'
                  : 'stored';
            const equalTimestamp =
                FIXTURE_NOW - Math.floor(index / 3) * 3_600_000;
            const publishedAt =
                index === checked.entriesPerFeed - 1
                    ? FIXTURE_NOW - 365 * 86_400_000
                    : equalTimestamp;
            const createdAt =
                FIXTURE_NOW - (checked.entriesPerFeed - index) * 1_000;
            rows.entries.push([
                id,
                feedId(feedIndex),
                bytes(id),
                `guid:${feedIndex}:${index}`,
                `Article ${id}: equal-time and late-publication coverage`,
                `https://sites${feedIndex % 5}.example.test/${feedId(feedIndex)}/articles/${id}`,
                index % 5 === 0 ? null : `Author ${index % 11}`,
                publishedAt,
                publishedAt + 1_000,
                contentStatus,
                createdAt,
                FIXTURE_NOW,
            ]);
            if (contentStatus === 'stored') {
                const targetBytes = isNearLimit
                    ? 1_795_000
                    : checked.normalContentBytes + (index % 4) * 1_024;
                const content = article(id, targetBytes);
                const hash = await sha256(content);
                entryHashes.set(id, hash);
                rows.entry_contents.push([
                    id,
                    content,
                    hash,
                    new TextEncoder().encode(content).byteLength,
                    createdAt,
                    FIXTURE_NOW,
                ]);
            }
        }

        const jobId = 2_000_000 + feedIndex;
        const operationId = `refresh:fixture:${id}`;
        const stateIndex = feedIndex % 4;
        const jobState = ['pending', 'pending', 'queued', 'dead_lettered'][
            stateIndex
        ] as string;
        const completedAt = jobState === 'dead_lettered' ? FIXTURE_NOW : null;
        rows.jobs.push([
            jobId,
            operationId,
            'feed_refresh',
            jobState,
            JSON.stringify({ feedId: id, trigger: 'scheduled' }),
            stateIndex === 3 ? 5 : 0,
            5,
            FIXTURE_NOW - 60_000,
            null,
            null,
            null,
            completedAt,
            FIXTURE_NOW - 120_000,
            FIXTURE_NOW,
        ]);
        const outboxState = ['pending', 'leased', 'sent', 'dead_lettered'][
            stateIndex
        ] as string;
        rows.outbox_messages.push([
            3_000_000 + feedIndex,
            jobId,
            'feed_refresh',
            JSON.stringify({ operationId }),
            outboxState,
            stateIndex === 3 ? 5 : 0,
            FIXTURE_NOW - 30_000,
            outboxState === 'leased' ? 'expired-fixture-worker' : null,
            outboxState === 'leased' ? FIXTURE_NOW - 1 : null,
            outboxState === 'sent' ? FIXTURE_NOW - 10_000 : null,
            FIXTURE_NOW - 120_000,
            FIXTURE_NOW,
        ]);
        for (let historyIndex = 0; historyIndex < 3; historyIndex += 1) {
            const refreshedAt =
                FIXTURE_NOW -
                (historyIndex === 0 ? 180 : historyIndex) * 86_400_000;
            rows.feed_refreshes.push([
                4_000_000 + feedIndex * 3 + historyIndex,
                id,
                historyIndex === 2 ? jobId : null,
                refreshedAt,
                historyIndex === 1 ? 0 : 1,
                historyIndex === 0 ? 1 : 0,
                historyIndex === 1 ? 503 : 200,
                historyIndex === 1 ? 0 : checked.entriesPerFeed,
                historyIndex === 2 ? 2 : 0,
                0,
                120 + historyIndex,
                refreshedAt,
            ]);
        }
    }

    for (let userIndex = 0; userIndex < checked.users; userIndex += 1) {
        const id = userId(userIndex);
        for (let feedIndex = 0; feedIndex < checked.feeds; feedIndex += 1) {
            const feed = feedId(feedIndex);
            const category = categoryId(userIndex, feedIndex % 3);
            rows.feed_subscriptions.push([
                id,
                feed,
                category,
                feedIndex % 7 === 0 ? `Pinned Feed ${feedIndex + 1}` : null,
                feedIndex % 11 === 0
                    ? JSON.stringify({ include: ['cloudflare', 'sqlite'] })
                    : null,
                entryId(feedIndex, watermarkIndex),
                FIXTURE_NOW - 30 * 86_400_000,
                FIXTURE_NOW,
            ]);

            const interactions = new Map<number, MutableInteraction>();
            const at = (index: number): MutableInteraction => {
                const existing = interactions.get(index);
                if (existing !== undefined) return existing;
                const value: MutableInteraction = {
                    readOverride: null,
                    readChangedAt: null,
                    starredAt: null,
                    archivedAt: null,
                    filteredAt: null,
                };
                interactions.set(index, value);
                return value;
            };
            const unread = at(1);
            unread.readOverride = 0;
            unread.readChangedAt = FIXTURE_NOW - 4_000;
            const explicitRead = at(checked.entriesPerFeed - 2);
            explicitRead.readOverride = 1;
            explicitRead.readChangedAt = FIXTURE_NOW - 3_000;
            at(watermarkIndex + 2).starredAt = FIXTURE_NOW - 2_000;
            at(Math.max(2, watermarkIndex - 2)).archivedAt =
                FIXTURE_NOW - 1_000;
            at(7).filteredAt = FIXTURE_NOW;

            for (const [index, interaction] of interactions) {
                rows.entry_interactions.push([
                    id,
                    feed,
                    entryId(feedIndex, index),
                    interaction.readOverride,
                    interaction.readChangedAt,
                    interaction.starredAt,
                    interaction.archivedAt,
                    interaction.filteredAt,
                    FIXTURE_NOW - 5_000,
                    FIXTURE_NOW,
                ]);
            }
        }

        const importId = 5_000_000 + userIndex;
        rows.opml_imports.push([
            importId,
            id,
            `reader-${id}-subscriptions.opml`,
            'completed',
            3,
            3,
            0,
            0,
            FIXTURE_NOW - 20_000,
            FIXTURE_NOW - 10_000,
            FIXTURE_NOW - 30_000,
            FIXTURE_NOW - 10_000,
        ]);
        for (let position = 0; position < 3; position += 1) {
            const feedIndex = position % checked.feeds;
            const feed = feedId(feedIndex);
            const category = categoryId(userIndex, feedIndex % 3);
            const url = `https://feeds${feedIndex % 5}.example.test/${feed}.xml`;
            rows.opml_import_items.push([
                6_000_000 + userIndex * 10 + position,
                importId,
                id,
                position,
                `opml:${importId}:${position}`,
                null,
                `Imported Feed ${position + 1}`,
                url,
                url,
                `https://sites${feedIndex % 5}.example.test/${feed}/`,
                JSON.stringify([
                    ['Engineering', 'Research', 'News'][feedIndex % 3],
                ]),
                'succeeded',
                1,
                5,
                feed,
                category,
                FIXTURE_NOW - 19_000,
                FIXTURE_NOW - 11_000,
                FIXTURE_NOW - 30_000,
                FIXTURE_NOW - 11_000,
            ]);
        }
    }

    for (let feedIndex = 0; feedIndex < checked.feeds; feedIndex += 1) {
        let summaryIndex = 2;
        let id = entryId(feedIndex, summaryIndex);
        let hash = entryHashes.get(id);
        while (
            hash === undefined &&
            summaryIndex < checked.entriesPerFeed - 1
        ) {
            summaryIndex += 1;
            id = entryId(feedIndex, summaryIndex);
            hash = entryHashes.get(id);
        }
        if (hash === undefined)
            throw new Error(
                `missing stored summary entry for feed ${feedIndex}`,
            );
        rows.entry_summaries.push([
            7_000_000 + feedIndex,
            id,
            userId(0),
            null,
            hash,
            'gemini-2.5-flash',
            'v1',
            `<p>Deterministic summary for article ${id}.</p>`,
            FIXTURE_NOW - 500,
            FIXTURE_NOW - 500,
        ]);
    }

    const tables = Object.fromEntries(
        Object.entries(TABLE_COLUMNS).map(([table, columns]) => [
            table,
            { columns, rows: rows[table] ?? [] },
        ]),
    );
    const expectedCounts = Object.fromEntries(
        Object.entries(tables).map(([table, value]) => [
            table,
            value.rows.length,
        ]),
    );
    return {
        config: checked,
        generatedAt: FIXTURE_NOW,
        tables,
        expectedCounts,
        semantics: {
            primaryUserId: userId(0),
            primaryFeedId: feedId(0),
            primaryCategoryId: categoryId(0, 0),
            equalTimestampEntryIds: [entryId(0, 0), entryId(0, 1)],
            lateOldEntryId: entryId(0, checked.entriesPerFeed - 1),
            explicitUnreadEntryId: entryId(0, 1),
            explicitReadEntryId: entryId(0, checked.entriesPerFeed - 2),
            filteredEntryId: entryId(0, 7),
            starredEntryId: entryId(0, watermarkIndex + 2),
            archivedEntryId: entryId(0, Math.max(2, watermarkIndex - 2)),
            nearLimitEntryId: entryId(0, 0),
            oversizedEntryId: entryId(0, 1),
            oversizedSourceBytes: MAX_STORED_CONTENT_BYTES + 1,
        },
    };
};

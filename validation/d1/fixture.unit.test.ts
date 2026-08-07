import { describe, expect, it } from 'vitest';

import { generateRepresentativeFixture, resolveFixtureConfig } from './fixture';

describe('representative D1 fixture generator', () => {
    it('generates deterministic target-schema rows', async () => {
        const config = resolveFixtureConfig('ci', {
            users: 1,
            feeds: 2,
            entriesPerFeed: 12,
            normalContentBytes: 256,
        });
        const first = await generateRepresentativeFixture(config);
        const second = await generateRepresentativeFixture(config);

        expect(first).toEqual(second);
        expect(first.expectedCounts.jobs).toBe(
            config.feeds + config.historicalRefreshJobs,
        );
        expect(first.expectedCounts.outbox_messages).toBe(
            config.feeds + config.historicalRefreshJobs,
        );
    });

    it('classifies near-limit, oversized, equal-time, late-old, and sparse states', async () => {
        const fixture = await generateRepresentativeFixture(
            resolveFixtureConfig('ci', {
                users: 1,
                feeds: 1,
                entriesPerFeed: 16,
                normalContentBytes: 256,
            }),
        );
        const entries = fixture.tables.entries;
        const contents = fixture.tables.entry_contents;
        const interactions = fixture.tables.entry_interactions;
        if (
            entries === undefined ||
            contents === undefined ||
            interactions === undefined
        ) {
            throw new Error('fixture tables missing');
        }
        const entryIdIndex = entries.columns.indexOf('id');
        const statusIndex = entries.columns.indexOf('content_status');
        const publishedIndex = entries.columns.indexOf('published_at');
        const contentEntryIdIndex = contents.columns.indexOf('entry_id');
        const contentSizeIndex = contents.columns.indexOf('encoded_size_bytes');
        const byId = new Map(
            entries.rows.map((row) => [row[entryIdIndex], row]),
        );
        const contentById = new Map(
            contents.rows.map((row) => [row[contentEntryIdIndex], row]),
        );

        expect(
            byId.get(fixture.semantics.nearLimitEntryId)?.[statusIndex],
        ).toBe('stored');
        expect(
            contentById.get(fixture.semantics.nearLimitEntryId)?.[
                contentSizeIndex
            ],
        ).toBeGreaterThanOrEqual(1_790_000);
        expect(
            byId.get(fixture.semantics.oversizedEntryId)?.[statusIndex],
        ).toBe('oversized');
        expect(contentById.has(fixture.semantics.oversizedEntryId)).toBe(false);
        expect(
            fixture.semantics.equalTimestampEntryIds.map(
                (id) => byId.get(id)?.[publishedIndex],
            ),
        ).toEqual([
            byId.get(fixture.semantics.equalTimestampEntryIds[0])?.[
                publishedIndex
            ],
            byId.get(fixture.semantics.equalTimestampEntryIds[0])?.[
                publishedIndex
            ],
        ]);
        expect(
            byId.get(fixture.semantics.lateOldEntryId)?.[publishedIndex],
        ).toBeLessThan(
            Number(
                byId.get(fixture.semantics.equalTimestampEntryIds[0])?.[
                    publishedIndex
                ],
            ),
        );
        expect(interactions.rows.length / entries.rows.length).toBeLessThan(
            0.5,
        );
    });

    it('rejects profiles too small for semantic edge cases', () => {
        expect(() =>
            resolveFixtureConfig('ci', { entriesPerFeed: 11 }),
        ).toThrow('entriesPerFeed');
    });
});

import { describe, expect, it } from 'vitest';

import { isNewerIngestion, latestIngestion } from './entryIngestion';

describe('latestIngestion', () => {
    it('returns undefined for an empty list', () => {
        expect(latestIngestion([])).toBeUndefined();
    });

    it('finds the latest ingestion even when it is not the list head', () => {
        // A published_at-sorted list: the top entry was published last but
        // ingested first; the mid-list entry is the most recent ingestion.
        const entries = [
            { id: 1, createdAt: 100, publishedAt: 900 },
            { id: 5, createdAt: 300, publishedAt: 500 },
            { id: 2, createdAt: 100, publishedAt: 200 },
        ];
        expect(latestIngestion(entries)?.id).toBe(5);
    });

    it('breaks created_at ties by id', () => {
        const entries = [
            { id: 3, createdAt: 100 },
            { id: 8, createdAt: 100 },
        ];
        expect(latestIngestion(entries)?.id).toBe(8);
    });
});

describe('isNewerIngestion', () => {
    const latest = { id: 10, createdAt: 200 };

    it('detects a later ingestion regardless of publish order', () => {
        expect(isNewerIngestion({ id: 4, createdAt: 300 }, latest)).toBe(true);
    });

    it('detects a same-instant ingestion with a higher id', () => {
        expect(isNewerIngestion({ id: 11, createdAt: 200 }, latest)).toBe(true);
    });

    it('ignores the entry already known as latest', () => {
        expect(isNewerIngestion({ id: 10, createdAt: 200 }, latest)).toBe(
            false,
        );
    });

    it('ignores older ingestions', () => {
        expect(isNewerIngestion({ id: 12, createdAt: 100 }, latest)).toBe(
            false,
        );
    });
});

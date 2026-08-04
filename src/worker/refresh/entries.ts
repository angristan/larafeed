import { Effect } from 'effect';

import { type AuthCryptoError, sha256Bytes } from '../auth/crypto';
import type { NormalizedFeedEntry } from '../feeds';
import type { ProcessedRefreshEntry } from '../jobs';

export const prepareRefreshEntry = (
    entry: NormalizedFeedEntry,
    filteredUserIds: readonly number[],
): Effect.Effect<ProcessedRefreshEntry, AuthCryptoError> =>
    Effect.gen(function* () {
        const content =
            entry.contentStatus === 'stored' && entry.contentHtml !== null
                ? {
                      type: 'stored' as const,
                      html: entry.contentHtml,
                      hash: yield* sha256Bytes(entry.contentHtml),
                  }
                : entry.contentStatus === 'oversized'
                  ? ({ type: 'oversized' } as const)
                  : ({ type: 'empty' } as const);

        return {
            deduplicationKey: entry.deduplicationKey,
            sourceId: entry.sourceId,
            title: entry.title,
            url: entry.url,
            author: entry.author,
            publishedAt: entry.publishedAt,
            sourceUpdatedAt: entry.sourceUpdatedAt,
            updateMask: entry.updateMask,
            content,
            filteredUserIds,
        };
    });

import type { NormalizedFeedEntry } from './parser';
import type { FeedUpdatedResult } from './service';

export interface FeedDiscoveryCandidate {
    readonly result: FeedUpdatedResult;
    readonly identicalFeedUrls: readonly string[];
}

export interface FeedDiscoveryResult {
    readonly kind: 'direct' | 'website';
    readonly candidates: readonly FeedDiscoveryCandidate[];
}

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
    left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);

const sameRecentEntry = (
    left: NormalizedFeedEntry,
    right: NormalizedFeedEntry,
): boolean =>
    sameBytes(left.deduplicationKey, right.deduplicationKey) &&
    left.sourceIdentity === right.sourceIdentity &&
    left.sourceId === right.sourceId &&
    left.title === right.title &&
    left.url === right.url &&
    left.author === right.author &&
    left.sourceUpdatedAt === right.sourceUpdatedAt &&
    left.contentHtml === right.contentHtml &&
    left.contentEncodedSize === right.contentEncodedSize &&
    left.contentStatus === right.contentStatus &&
    left.updateMask.title === right.updateMask.title &&
    left.updateMask.url === right.updateMask.url &&
    left.updateMask.author === right.updateMask.author &&
    left.updateMask.publishedAt === right.updateMask.publishedAt &&
    left.updateMask.sourceUpdatedAt === right.updateMask.sourceUpdatedAt &&
    left.updateMask.content === right.updateMask.content &&
    (!left.updateMask.publishedAt || left.publishedAt === right.publishedAt);

export const feedsHaveIdenticalRecentContent = (
    left: FeedUpdatedResult,
    right: FeedUpdatedResult,
): boolean =>
    left.entryWindowTruncated !== true &&
    right.entryWindowTruncated !== true &&
    left.entries.length > 0 &&
    left.entries.length === right.entries.length &&
    left.entries.every((entry, index) =>
        sameRecentEntry(entry, right.entries[index]),
    );

export const annotateDiscoveryCandidates = (
    results: readonly FeedUpdatedResult[],
): readonly FeedDiscoveryCandidate[] =>
    results.map((result) => ({
        result,
        identicalFeedUrls: results
            .filter(
                (other) =>
                    other.finalUrl !== result.finalUrl &&
                    feedsHaveIdenticalRecentContent(result, other),
            )
            .map((other) => other.finalUrl),
    }));

import type { OpmlImportResponse } from '@shared/http';

import type { ProcessedRefreshEntry } from '../jobs';

export const OPML_IMPORT_JOB_KIND = 'opml_import_feed';
export const OPML_IMPORT_TOPIC = 'opml_import_feed';
export const MAX_OPML_CHARACTERS = 2_000_000;
export const MAX_OPML_FEEDS = 500;
export const MAX_OPML_DEPTH = 50;
export const MAX_CATEGORY_SEGMENT_LENGTH = 120;
export const MAX_CUSTOM_TITLE_LENGTH = 255;
export const MAX_FLATTENED_CATEGORY_LENGTH = 255;
export const MAX_IMPORT_ERRORS = 20;
export const MAX_RECENT_IMPORTS = 20;
export const MAX_OUTBOX_BATCH = MAX_OPML_FEEDS;
export const MAX_QUEUE_SEND_BATCH = 50;
export const MAX_RECOVERY_BATCH = 50;
export const MAX_OUTBOX_ATTEMPTS = 10;
export const DEFAULT_ITEM_MAX_ATTEMPTS = 5;
export const DEFAULT_JOB_LEASE_MS = 5 * 60_000;
export const DEFAULT_OUTBOX_LEASE_MS = 60_000;
export const MAX_BACKOFF_MS = 6 * 60 * 60_000;

export interface ParsedOpmlItem {
    readonly position: number;
    readonly title: string | null;
    readonly customTitle: string | null;
    readonly feedUrl: string;
    readonly normalizedFeedUrl: string;
    readonly siteUrl: string | null;
    readonly categoryPath: readonly string[];
}

export interface CreateImportItemInput extends ParsedOpmlItem {
    readonly id: number;
    readonly jobId: number;
    readonly outboxId: number;
    readonly operationId: string;
}

export interface CreateImportInput {
    readonly id: number;
    readonly userId: number;
    readonly filename: string | null;
    readonly items: readonly CreateImportItemInput[];
    readonly maxAttempts: number;
    readonly now: number;
}

export type OpmlItemState =
    | 'pending'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'skipped';

export interface OpmlQueueMessage {
    readonly operationId: string;
}

export interface OpmlQueueSender {
    readonly sendBatch: (
        messages: readonly OpmlQueueMessage[],
    ) => Promise<void>;
}

export interface LeasedOpmlOutboxMessage {
    readonly id: number;
    readonly jobId: number;
    readonly operationId: string;
    readonly attemptCount: number;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
}

export interface OpmlItemClaim {
    readonly itemId: number;
    readonly importId: number;
    readonly userId: number;
    readonly jobId: number;
    readonly operationId: string;
    readonly title: string | null;
    readonly customTitle: string | null;
    readonly feedUrl: string;
    readonly normalizedFeedUrl: string;
    readonly siteUrl: string | null;
    readonly categoryPath: readonly string[];
    readonly attemptCount: number;
    readonly maxAttempts: number;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
}

export type ClaimOpmlJobResult =
    | { readonly type: 'claimed'; readonly claim: OpmlItemClaim }
    | { readonly type: 'completed'; readonly state: 'succeeded' | 'canceled' }
    | { readonly type: 'dead'; readonly state: 'dead_lettered' }
    | { readonly type: 'busy'; readonly retryAt: number }
    | { readonly type: 'unavailable'; readonly retryAt: number }
    | { readonly type: 'missing' };

export interface DispatchResult {
    readonly leased: number;
    readonly sent: number;
    readonly released: number;
    readonly ambiguous: number;
}

export type OpmlQueueDecision =
    | { readonly action: 'ack' | 'dead'; readonly reason: string }
    | {
          readonly action: 'retry';
          readonly reason: string;
          readonly retryDelaySeconds: number;
      };

export interface OpmlFailureRecord {
    readonly terminal: boolean;
    readonly availableAt: number | null;
}

export interface OpmlCronResult {
    readonly recoveredJobs: number;
    readonly recoveredImports: number;
    readonly redispatchedJobs: number;
    readonly dispatched: DispatchResult;
}

export interface OpmlImportCreation {
    readonly response: OpmlImportResponse;
    readonly operationIds: readonly string[];
}

export interface OpmlExportSubscription {
    readonly category: string;
    readonly canonicalTitle: string;
    readonly customTitle: string | null;
    readonly feedUrl: string;
    readonly siteUrl: string | null;
}

export interface CompleteOpmlItemInput {
    readonly claim: OpmlItemClaim;
    readonly categoryId: number;
    readonly historyId: number;
    readonly feedUrl: string;
    readonly feedName: string;
    readonly categoryName: string;
    readonly siteUrl: string | null;
    readonly faviconUrl: string | null;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly publisherRefreshIntervalMs?: number | null;
    readonly httpStatus: number;
    readonly durationMs: number;
    readonly entries: readonly ProcessedRefreshEntry[];
    readonly completedAt: number;
    readonly nextRefreshAt: number;
}

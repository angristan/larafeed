import type { SubscriptionFilterRules } from '@shared/schemas/subscriptions';

export const FEED_REFRESH_JOB_KIND = 'feed_refresh';
export const FEED_REFRESH_TOPIC = 'feed-refresh';
export const MAX_CONTENT_BYTES = 1_800_000;
export const MAX_DUE_FEEDS = 100;
export const MAX_OUTBOX_MESSAGES = 100;
export const MAX_OUTBOX_ATTEMPTS = 10;
export const MAX_ERROR_CLASS_LENGTH = 64;
export const MAX_ERROR_MESSAGE_LENGTH = 512;
export const DEFAULT_MAX_ATTEMPTS = 8;
export const DEFAULT_JOB_LEASE_MS = 5 * 60_000;
export const DEFAULT_OUTBOX_LEASE_MS = 60_000;
export const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60_000;
export const MAX_BACKOFF_MS = 6 * 60 * 60_000;
export const FEED_REFRESH_RETENTION_MS = 90 * 24 * 60 * 60_000;
export const MAX_HISTORY_CLEANUP = 500;

export interface RefreshQueueMessage {
    readonly operationId: string;
}

export type RefreshTrigger = 'manual' | 'scheduled';

export interface RefreshJob {
    readonly id: number;
    readonly operationId: string;
    readonly feedId: number;
    readonly trigger: RefreshTrigger;
    readonly state: JobState;
    readonly attemptCount: number;
    readonly maxAttempts: number;
    readonly availableAt: number;
}

export type JobState =
    | 'pending'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'dead_lettered'
    | 'canceled';

export interface CreateRefreshJobInput {
    readonly jobId: number;
    readonly outboxId: number;
    readonly operationId: string;
    readonly feedId: number;
    readonly trigger: RefreshTrigger;
    readonly maxAttempts: number;
    readonly now: number;
}

export interface DueFeed {
    readonly id: number;
    readonly nextRefreshAt: number;
}

export interface LeasedOutboxMessage {
    readonly id: number;
    readonly jobId: number;
    readonly operationId: string;
    readonly attemptCount: number;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
}

export type ClaimRefreshJobResult =
    | { readonly type: 'claimed'; readonly claim: RefreshJobClaim }
    | {
          readonly type: 'completed';
          readonly state: 'succeeded' | 'canceled';
      }
    | { readonly type: 'dead'; readonly state: 'dead_lettered' }
    | {
          readonly type: 'busy';
          readonly retryAt: number;
      }
    | {
          readonly type: 'unavailable';
          readonly retryAt: number;
      }
    | { readonly type: 'missing' };

export interface RefreshJobClaim {
    readonly jobId: number;
    readonly operationId: string;
    readonly feedId: number;
    readonly trigger: RefreshTrigger;
    readonly attemptCount: number;
    readonly maxAttempts: number;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
}

export interface FeedSubscriptionFilter {
    readonly userId: number;
    readonly rules: SubscriptionFilterRules;
}

export interface FeedRefreshInput extends RefreshJobClaim {
    readonly feedUrl: string;
    readonly siteUrl: string | null;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly subscriptionFilters: readonly FeedSubscriptionFilter[];
}

export type RefreshEntryContent =
    | {
          readonly type: 'stored';
          readonly html: string;
          readonly hash: Uint8Array;
      }
    | { readonly type: 'empty' }
    | { readonly type: 'oversized' };

export interface ProcessedRefreshEntry {
    readonly deduplicationKey: Uint8Array;
    readonly sourceId: string | null;
    readonly title: string;
    readonly url: string | null;
    readonly author: string | null;
    readonly publishedAt: number;
    readonly sourceUpdatedAt: number | null;
    readonly content: RefreshEntryContent;
    readonly filteredUserIds: readonly number[];
}

export interface PersistedRefreshEntry extends ProcessedRefreshEntry {
    readonly id: number;
}

interface RefreshCompletionBase {
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly nextRefreshAt?: number;
    readonly httpStatus: number;
    readonly durationMs?: number;
}

export interface RefreshSuccess extends RefreshCompletionBase {
    readonly type: 'success';
    readonly feedName?: string;
    readonly siteUrl?: string | null;
    readonly faviconUrl?: string | null;
    readonly entries: readonly ProcessedRefreshEntry[];
}

export interface RefreshNotModified extends RefreshCompletionBase {
    readonly type: 'not_modified';
    readonly httpStatus: 304;
}

export interface RefreshFailure {
    readonly type: 'failure';
    readonly retryable: boolean;
    readonly markGone?: boolean;
    readonly retryAfterMs?: number;
    readonly errorClass: string;
    readonly errorMessage: string;
    readonly httpStatus?: number;
    readonly durationMs?: number;
}

export type RefreshProcessorResult =
    | RefreshSuccess
    | RefreshNotModified
    | RefreshFailure;

export interface CommitRefreshInput {
    readonly claim: RefreshJobClaim;
    readonly historyId: number;
    readonly completedAt: number;
    readonly etag: string | null;
    readonly lastModified: string | null;
    readonly nextRefreshAt: number;
    readonly httpStatus: number;
    readonly durationMs: number | null;
    readonly notModified: boolean;
    readonly feedName?: string;
    readonly siteUrl?: string | null;
    readonly faviconUrl?: string | null;
    readonly entries: readonly PersistedRefreshEntry[];
}

export interface RecordRefreshFailureInput {
    readonly claim: RefreshJobClaim;
    readonly historyId: number;
    readonly failedAt: number;
    readonly retryable: boolean;
    readonly markGone?: boolean;
    readonly errorClass: string;
    readonly errorMessage: string;
    readonly httpStatus: number | null;
    readonly durationMs: number | null;
    readonly retryAt: number;
}

export interface RefreshFailureRecord {
    readonly terminal: boolean;
    readonly availableAt: number | null;
}

export type QueueDecision =
    | { readonly action: 'ack'; readonly reason: string }
    | {
          readonly action: 'retry';
          readonly reason: string;
          readonly retryDelaySeconds: number;
      }
    | { readonly action: 'dead'; readonly reason: string };

export interface QueueSender {
    readonly send: (message: RefreshQueueMessage) => Promise<void>;
}

export type RefreshProcessor = (
    input: FeedRefreshInput,
) => Promise<RefreshProcessorResult>;

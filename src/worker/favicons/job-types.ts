export const FAVICON_REFRESH_JOB_KIND = 'favicon_refresh';
export const FAVICON_REFRESH_TOPIC = 'favicon-refresh';
export const FAVICON_QUEUE_MAX_ATTEMPTS = 6;
export const FAVICON_JOB_LEASE_MS = 5 * 60_000;
export const FAVICON_OUTBOX_LEASE_MS = 60_000;
export const FAVICON_REDRIVE_AGE_MS = 15 * 60_000;
export const FAVICON_MAX_BACKOFF_MS = 6 * 60 * 60_000;
export const FAVICON_MAX_OUTBOX_ATTEMPTS = 10;
export const FAVICON_MAX_DISPATCH = 100;

export interface FaviconQueueMessage {
    readonly operationId: string;
}

export type FaviconQueueDecision =
    | { readonly action: 'ack' | 'dead'; readonly reason: string }
    | {
          readonly action: 'retry';
          readonly reason: string;
          readonly retryDelaySeconds: number;
      };

export interface FaviconJobClaim {
    readonly jobId: number;
    readonly operationId: string;
    readonly feedId: number;
    readonly attemptCount: number;
    readonly maxAttempts: number;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
}

export type ClaimFaviconJobResult =
    | { readonly type: 'claimed'; readonly claim: FaviconJobClaim }
    | { readonly type: 'completed'; readonly state: 'succeeded' | 'canceled' }
    | { readonly type: 'dead'; readonly state: 'dead_lettered' }
    | { readonly type: 'busy'; readonly retryAt: number }
    | { readonly type: 'unavailable'; readonly retryAt: number }
    | { readonly type: 'missing' };

export interface LeasedFaviconOutboxMessage {
    readonly id: number;
    readonly jobId: number;
    readonly operationId: string;
    readonly attemptCount: number;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
}

export interface FaviconDispatchResult {
    readonly leased: number;
    readonly sent: number;
    readonly released: number;
    readonly ambiguous: number;
}

export interface FaviconCronResult {
    readonly recoveredJobs: number;
    readonly redrivenJobs: number;
    readonly deadLetteredJobs: number;
    readonly reservedJobs: number;
    readonly dispatched: FaviconDispatchResult;
}

export class JobStorageError extends Error {
    readonly _tag = 'JobStorageError';
    readonly operation: string;

    constructor(operation: string, cause: unknown) {
        super(`Job storage operation failed: ${operation}`, { cause });
        this.name = 'JobStorageError';
        this.operation = operation;
    }
}

export class JobInvariantError extends Error {
    readonly _tag = 'JobInvariantError';
    readonly operation: string;

    constructor(operation: string, message: string) {
        super(`Job invariant failed during ${operation}: ${message}`);
        this.name = 'JobInvariantError';
        this.operation = operation;
    }
}

export class FeedNotFoundError extends Error {
    readonly _tag = 'FeedNotFoundError';
    readonly feedId: number;

    constructor(feedId: number) {
        super(`Feed not found: ${feedId}`);
        this.name = 'FeedNotFoundError';
        this.feedId = feedId;
    }
}

export class RefreshLeaseLostError extends Error {
    readonly _tag = 'RefreshLeaseLostError';
    readonly operationId: string;

    constructor(operationId: string) {
        super(`Refresh lease is no longer owned: ${operationId}`);
        this.name = 'RefreshLeaseLostError';
        this.operationId = operationId;
    }
}

export class RefreshAlreadyActiveError extends Error {
    readonly _tag = 'RefreshAlreadyActiveError';
    readonly feedId: number;

    constructor(feedId: number) {
        super(`A refresh is already active for feed: ${feedId}`);
        this.name = 'RefreshAlreadyActiveError';
        this.feedId = feedId;
    }
}

export class ManualRefreshCooldownError extends Error {
    readonly _tag = 'ManualRefreshCooldownError';
    readonly feedId: number;
    readonly retryAt: number;

    constructor(feedId: number, retryAt: number) {
        super(`Manual refresh cooldown is active for feed: ${feedId}`);
        this.name = 'ManualRefreshCooldownError';
        this.feedId = feedId;
        this.retryAt = retryAt;
    }
}

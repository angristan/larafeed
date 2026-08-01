export class JobStorageError extends Error {
    readonly operation: string;

    constructor(operation: string, cause: unknown) {
        super(`Job storage operation failed: ${operation}`, { cause });
        this.name = 'JobStorageError';
        this.operation = operation;
    }
}

export class JobInvariantError extends Error {
    readonly operation: string;

    constructor(operation: string, message: string) {
        super(`Job invariant failed during ${operation}: ${message}`);
        this.name = 'JobInvariantError';
        this.operation = operation;
    }
}

export class FeedNotFoundError extends Error {
    readonly feedId: number;

    constructor(feedId: number) {
        super(`Feed not found: ${feedId}`);
        this.name = 'FeedNotFoundError';
        this.feedId = feedId;
    }
}

export class RefreshLeaseLostError extends Error {
    readonly operationId: string;

    constructor(operationId: string) {
        super(`Refresh lease is no longer owned: ${operationId}`);
        this.name = 'RefreshLeaseLostError';
        this.operationId = operationId;
    }
}

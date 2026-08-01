export class OpmlValidationError extends Error {
    readonly _tag = 'OpmlValidationError';

    constructor(readonly reason: string) {
        super(`Invalid OPML: ${reason}`);
        this.name = 'OpmlValidationError';
    }
}

export class OpmlNotFoundError extends Error {
    readonly _tag = 'OpmlNotFoundError';

    constructor() {
        super('OPML import not found');
        this.name = 'OpmlNotFoundError';
    }
}

export class OpmlRateLimitedError extends Error {
    readonly _tag = 'OpmlRateLimitedError';

    constructor() {
        super('OPML request rate limited');
        this.name = 'OpmlRateLimitedError';
    }
}

export class OpmlStorageError extends Error {
    readonly _tag = 'OpmlStorageError';

    constructor(
        readonly operation: string,
        cause: unknown,
    ) {
        super(`OPML storage operation failed: ${operation}`, { cause });
        this.name = 'OpmlStorageError';
    }
}

export class OpmlInvariantError extends Error {
    readonly _tag = 'OpmlInvariantError';

    constructor(
        readonly operation: string,
        message: string,
    ) {
        super(`OPML invariant failed during ${operation}: ${message}`);
        this.name = 'OpmlInvariantError';
    }
}

export class OpmlLeaseLostError extends Error {
    readonly _tag = 'OpmlLeaseLostError';

    constructor(readonly operationId: string) {
        super(`OPML item lease is no longer owned: ${operationId}`);
        this.name = 'OpmlLeaseLostError';
    }
}

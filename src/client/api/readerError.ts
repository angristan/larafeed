import type { ApiErrorResponse } from '@shared/http';

export type ReaderClientErrorKind = 'transport' | 'status' | 'decode';

export class ReaderClientError extends Error {
    readonly _tag = 'ReaderClientError';

    constructor(
        readonly kind: ReaderClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'ReaderClientError';
    }
}

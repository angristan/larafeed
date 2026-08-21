import type { ApiErrorResponse } from '@shared/http';

export type AuthClientErrorKind = 'transport' | 'status' | 'decode';

export class AuthClientError extends Error {
    readonly _tag = 'AuthClientError';

    constructor(
        readonly kind: AuthClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'AuthClientError';
    }
}

import { Schema } from 'effect';

export * from './schemas/account';
export * from './schemas/auth';
export * from './schemas/charts';
export { HealthResponse } from './schemas/health';
export * from './schemas/images';
export * from './schemas/jobs';
export * from './schemas/opml';
export * from './schemas/reader';
export * from './schemas/subscriptions';
export * from './schemas/summaries';

export const ApiErrorCode = Schema.Literals([
    'validation_error',
    'authentication_failed',
    'unauthenticated',
    'forbidden',
    'csrf_invalid',
    'human_verification_failed',
    'access_link_invalid',
    'not_found',
    'conflict',
    'rate_limited',
    'service_unavailable',
    'internal_server_error',
]);
export type ApiErrorCode = typeof ApiErrorCode.Type;

export class ApiErrorResponse extends Schema.Class<ApiErrorResponse>(
    'ApiErrorResponse',
)({
    error: Schema.Struct({
        code: ApiErrorCode,
        message: Schema.String,
    }),
}) {}

import { Schema } from 'effect';

export { HealthResponse } from './schemas/health';

export const ApiErrorCode = Schema.Literals([
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

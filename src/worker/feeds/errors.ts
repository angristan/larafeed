import { Schema } from 'effect';

const FeedPolicyReason = Schema.Literals([
    'invalid_url',
    'unsupported_protocol',
    'credentials_forbidden',
    'fragment_forbidden',
    'nonstandard_port',
    'forbidden_hostname',
    'forbidden_ip_address',
    'too_many_redirects',
    'redirect_location_missing',
    'binary_content_type',
]);

export type FeedPolicyReason = typeof FeedPolicyReason.Type;

export class FeedPolicyError extends Schema.TaggedError<FeedPolicyError>()(
    'FeedPolicyError',
    {
        reason: FeedPolicyReason,
    },
) {
    readonly retryable = false;
}

export class FeedParseError extends Schema.TaggedError<FeedParseError>()(
    'FeedParseError',
    {
        reason: Schema.Literals([
            'empty_document',
            'forbidden_declaration',
            'malformed_json',
            'malformed_xml',
            'too_many_entries',
            'unsupported_feed',
        ]),
    },
) {
    readonly retryable = false;
}

export class FeedSizeError extends Schema.TaggedError<FeedSizeError>()(
    'FeedSizeError',
    {
        limitBytes: Schema.Number,
    },
) {
    readonly retryable = false;
}

export class FeedHttpError extends Schema.TaggedError<FeedHttpError>()(
    'FeedHttpError',
    {
        status: Schema.Number,
        retryable: Schema.Boolean,
        retryAfterMs: Schema.optionalKey(Schema.Number),
    },
) {}

export class FeedNetworkError extends Schema.TaggedError<FeedNetworkError>()(
    'FeedNetworkError',
    {},
) {
    readonly retryable = true;
}

export class FeedTimeoutError extends Schema.TaggedError<FeedTimeoutError>()(
    'FeedTimeoutError',
    {
        timeoutMs: Schema.Number,
    },
) {
    readonly retryable = true;
}

export type FeedRefreshError =
    | FeedPolicyError
    | FeedParseError
    | FeedSizeError
    | FeedHttpError
    | FeedNetworkError
    | FeedTimeoutError;

export const isFeedRefreshError = (cause: unknown): cause is FeedRefreshError =>
    cause instanceof FeedPolicyError ||
    cause instanceof FeedParseError ||
    cause instanceof FeedSizeError ||
    cause instanceof FeedHttpError ||
    cause instanceof FeedNetworkError ||
    cause instanceof FeedTimeoutError;

import { Schema } from 'effect';

export class SubscriptionValidationError extends Schema.TaggedError<SubscriptionValidationError>()(
    'SubscriptionValidationError',
    {},
) {}

export class SubscriptionNotFound extends Schema.TaggedError<SubscriptionNotFound>()(
    'SubscriptionNotFound',
    {},
) {}

export class SubscriptionConflict extends Schema.TaggedError<SubscriptionConflict>()(
    'SubscriptionConflict',
    {
        reason: Schema.Literals([
            'category_name_exists',
            'category_in_use',
            'already_subscribed',
            'filter_rebuild_too_large',
            'filter_rebuild_stale',
        ]),
    },
) {}

export class SubscriptionStorageError extends Schema.TaggedError<SubscriptionStorageError>()(
    'SubscriptionStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class SubscriptionInvariantError extends Schema.TaggedError<SubscriptionInvariantError>()(
    'SubscriptionInvariantError',
    {
        operation: Schema.String,
    },
) {}

export class SubscriptionRateLimited extends Schema.TaggedError<SubscriptionRateLimited>()(
    'SubscriptionRateLimited',
    {},
) {}

export class SubscriptionFeedError extends Schema.TaggedError<SubscriptionFeedError>()(
    'SubscriptionFeedError',
    {
        reason: Schema.Literals([
            'invalid_url',
            'unresolvable_host',
            'unsupported_feed',
            'feed_too_large',
            'upstream_rate_limited',
            'temporarily_unavailable',
        ]),
    },
) {}

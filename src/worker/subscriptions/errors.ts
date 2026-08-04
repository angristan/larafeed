import { Schema } from 'effect';

export class SubscriptionValidationError extends Schema.TaggedErrorClass<SubscriptionValidationError>()(
    'SubscriptionValidationError',
    {},
) {}

export class SubscriptionNotFound extends Schema.TaggedErrorClass<SubscriptionNotFound>()(
    'SubscriptionNotFound',
    {},
) {}

export class SubscriptionConflict extends Schema.TaggedErrorClass<SubscriptionConflict>()(
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

export class SubscriptionStorageError extends Schema.TaggedErrorClass<SubscriptionStorageError>()(
    'SubscriptionStorageError',
    {
        operation: Schema.String,
        cause: Schema.Defect(),
    },
) {}

export class SubscriptionInvariantError extends Schema.TaggedErrorClass<SubscriptionInvariantError>()(
    'SubscriptionInvariantError',
    {
        operation: Schema.String,
    },
) {}

export class SubscriptionRateLimited extends Schema.TaggedErrorClass<SubscriptionRateLimited>()(
    'SubscriptionRateLimited',
    {},
) {}

export class SubscriptionFeedError extends Schema.TaggedErrorClass<SubscriptionFeedError>()(
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

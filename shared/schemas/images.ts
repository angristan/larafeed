import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);

export class FaviconRefreshResponse extends Schema.Class<FaviconRefreshResponse>(
    'FaviconRefreshResponse',
)({
    feedId: SafeId,
    faviconUrl: Schema.NullOr(Schema.String),
}) {}

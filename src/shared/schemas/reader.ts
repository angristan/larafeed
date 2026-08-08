import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonEmptyString = Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMinLength(1),
);

export const ReaderFilter = Schema.Literals([
    'all',
    'unread',
    'read',
    'favorites',
]);
export type ReaderFilter = typeof ReaderFilter.Type;

export const ReaderOrder = Schema.Literals(['published_at', 'created_at']);
export type ReaderOrder = typeof ReaderOrder.Type;

export class ReaderCategory extends Schema.Class<ReaderCategory>(
    'ReaderCategory',
)({
    id: SafeId,
    name: NonEmptyString,
}) {}

export class ReaderCategoryListResponse extends Schema.Class<ReaderCategoryListResponse>(
    'ReaderCategoryListResponse',
)({
    categories: Schema.Array(ReaderCategory),
}) {}

export class ReaderSubscription extends Schema.Class<ReaderSubscription>(
    'ReaderSubscription',
)({
    feedId: SafeId,
    categoryId: SafeId,
    feedName: NonEmptyString,
    customFeedName: Schema.NullOr(Schema.String),
    faviconUrl: Schema.NullOr(Schema.String),
    faviconIsDark: Schema.NullOr(Schema.Boolean),
    totalCount: Count,
    unreadCount: Count,
}) {}

export class ReaderSubscriptionListResponse extends Schema.Class<ReaderSubscriptionListResponse>(
    'ReaderSubscriptionListResponse',
)({
    subscriptions: Schema.Array(ReaderSubscription),
}) {}

export class ReaderCountsResponse extends Schema.Class<ReaderCountsResponse>(
    'ReaderCountsResponse',
)({
    total: Count,
    unread: Count,
    read: Count,
    starred: Count,
}) {}

export class ReaderEntry extends Schema.Class<ReaderEntry>('ReaderEntry')({
    id: SafeId,
    feedId: SafeId,
    title: Schema.String,
    url: Schema.NullOr(Schema.String),
    author: Schema.NullOr(Schema.String),
    publishedAt: Timestamp,
    createdAt: Timestamp,
    feedName: NonEmptyString,
    customFeedName: Schema.NullOr(Schema.String),
    faviconUrl: Schema.NullOr(Schema.String),
    faviconIsDark: Schema.NullOr(Schema.Boolean),
    read: Schema.Boolean,
    starred: Schema.Boolean,
    archived: Schema.Boolean,
}) {}

export class ReaderEntryListResponse extends Schema.Class<ReaderEntryListResponse>(
    'ReaderEntryListResponse',
)({
    entries: Schema.Array(ReaderEntry),
    total: Count,
    nextCursor: Schema.NullOr(NonEmptyString),
}) {}

export class ReaderEntryDetail extends Schema.Class<ReaderEntryDetail>(
    'ReaderEntryDetail',
)({
    ...ReaderEntry.fields,
    contentHtml: Schema.NullOr(Schema.String),
    readChangedAt: Schema.NullOr(Timestamp),
    starredAt: Schema.NullOr(Timestamp),
    archivedAt: Schema.NullOr(Timestamp),
}) {}

export class DesiredReadRequest extends Schema.Class<DesiredReadRequest>(
    'DesiredReadRequest',
)({
    read: Schema.Boolean,
}) {}

export class DesiredStarRequest extends Schema.Class<DesiredStarRequest>(
    'DesiredStarRequest',
)({
    starred: Schema.Boolean,
}) {}

export class DesiredArchiveRequest extends Schema.Class<DesiredArchiveRequest>(
    'DesiredArchiveRequest',
)({
    archived: Schema.Boolean,
}) {}

export class ReaderInteractionResponse extends Schema.Class<ReaderInteractionResponse>(
    'ReaderInteractionResponse',
)({
    entryId: SafeId,
    feedId: SafeId,
    read: Schema.Boolean,
    readChangedAt: Schema.NullOr(Timestamp),
    starred: Schema.Boolean,
    starredAt: Schema.NullOr(Timestamp),
    archived: Schema.Boolean,
    archivedAt: Schema.NullOr(Timestamp),
}) {}

export class ReaderReadThroughResponse extends Schema.Class<ReaderReadThroughResponse>(
    'ReaderReadThroughResponse',
)({
    feedId: SafeId,
    readThroughEntryId: Schema.NullOr(SafeId),
}) {}

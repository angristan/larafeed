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
const CategoryName = NonEmptyString.check(Schema.isMaxLength(255));
const CustomFeedName = Schema.String.check(
    Schema.isTrimmed(),
    Schema.isMaxLength(255),
);
const FilterPattern = NonEmptyString.check(Schema.isMaxLength(200));
const FilterPatterns = Schema.Array(FilterPattern).check(
    Schema.isMaxLength(20),
);

export class SubscriptionFilterRules extends Schema.Class<SubscriptionFilterRules>(
    'SubscriptionFilterRules',
)({
    excludeTitle: FilterPatterns,
    excludeContent: FilterPatterns,
    excludeAuthor: FilterPatterns,
}) {}

export class ManagedCategory extends Schema.Class<ManagedCategory>(
    'ManagedCategory',
)({
    id: SafeId,
    name: CategoryName,
    subscriptionCount: Count,
}) {}

export class SubscriptionRefreshRecord extends Schema.Class<SubscriptionRefreshRecord>(
    'SubscriptionRefreshRecord',
)({
    id: SafeId,
    refreshedAt: Timestamp,
    successful: Schema.Boolean,
    notModified: Schema.Boolean,
    httpStatus: Schema.NullOr(Schema.Int),
    entriesCreated: Count,
    errorClass: Schema.NullOr(Schema.String),
    errorMessage: Schema.NullOr(Schema.String),
}) {}

export class ManagedSubscription extends Schema.Class<ManagedSubscription>(
    'ManagedSubscription',
)({
    feedId: SafeId,
    categoryId: SafeId,
    categoryName: CategoryName,
    feedName: NonEmptyString,
    customFeedName: Schema.NullOr(CustomFeedName),
    feedUrl: NonEmptyString,
    siteUrl: Schema.NullOr(Schema.String),
    faviconUrl: Schema.NullOr(Schema.String),
    faviconIsDark: Schema.NullOr(Schema.Boolean),
    entryCount: Count,
    unreadCount: Count,
    isGone: Schema.Boolean,
    consecutiveFailures: Count,
    lastAttemptAt: Schema.NullOr(Timestamp),
    lastSuccessfulRefreshAt: Schema.NullOr(Timestamp),
    lastFailedRefreshAt: Schema.NullOr(Timestamp),
    lastErrorClass: Schema.NullOr(Schema.String),
    lastErrorMessage: Schema.NullOr(Schema.String),
    filterRules: SubscriptionFilterRules,
    refreshes: Schema.Array(SubscriptionRefreshRecord),
}) {}

export class SubscriptionManagementResponse extends Schema.Class<SubscriptionManagementResponse>(
    'SubscriptionManagementResponse',
)({
    categories: Schema.Array(ManagedCategory),
    subscriptions: Schema.Array(ManagedSubscription),
}) {}

export class CreateCategoryRequest extends Schema.Class<CreateCategoryRequest>(
    'CreateCategoryRequest',
)({
    name: CategoryName,
}) {}

export class UpdateCategoryRequest extends Schema.Class<UpdateCategoryRequest>(
    'UpdateCategoryRequest',
)({
    name: CategoryName,
}) {}

export class CategoryMutationResponse extends Schema.Class<CategoryMutationResponse>(
    'CategoryMutationResponse',
)({
    category: ManagedCategory,
}) {}

export class CreateSubscriptionRequest extends Schema.Class<CreateSubscriptionRequest>(
    'CreateSubscriptionRequest',
)({
    feedUrl: NonEmptyString.check(Schema.isMaxLength(2_048)),
    categoryId: Schema.optionalKey(SafeId),
    categoryName: Schema.optionalKey(CategoryName),
}) {}

export class CreateSubscriptionResponse extends Schema.Class<CreateSubscriptionResponse>(
    'CreateSubscriptionResponse',
)({
    subscription: ManagedSubscription,
    createdFeed: Schema.Boolean,
    createdSubscription: Schema.Boolean,
}) {}

export class UpdateSubscriptionRequest extends Schema.Class<UpdateSubscriptionRequest>(
    'UpdateSubscriptionRequest',
)({
    categoryId: SafeId,
    customFeedName: Schema.NullOr(CustomFeedName),
    filterRules: SubscriptionFilterRules,
}) {}

export class SubscriptionMutationResponse extends Schema.Class<SubscriptionMutationResponse>(
    'SubscriptionMutationResponse',
)({
    subscription: ManagedSubscription,
}) {}

export class DeleteResourceResponse extends Schema.Class<DeleteResourceResponse>(
    'DeleteResourceResponse',
)({
    deleted: Schema.Boolean,
}) {}

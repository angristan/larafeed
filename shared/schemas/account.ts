import { Schema } from 'effect';

const SafeId = Schema.Int.check(
    Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
);
const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonEmpty = Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1));
const Email = NonEmpty.check(Schema.isMaxLength(320));

export class AccountProfile extends Schema.Class<AccountProfile>(
    'AccountProfile',
)({
    id: SafeId,
    username: NonEmpty,
    email: Email,
    displayName: NonEmpty,
    isAdmin: Schema.Boolean,
    createdAt: Timestamp,
}) {}

export class UpdateAccountProfileRequest extends Schema.Class<UpdateAccountProfileRequest>(
    'UpdateAccountProfileRequest',
)({
    email: Email,
    displayName: NonEmpty.check(Schema.isMaxLength(200)),
}) {}

export class AccountConfirmationRequest extends Schema.Class<AccountConfirmationRequest>(
    'AccountConfirmationRequest',
)({
    confirmation: NonEmpty.check(Schema.isMaxLength(100)),
}) {}

export class AccountActionResponse extends Schema.Class<AccountActionResponse>(
    'AccountActionResponse',
)({
    success: Schema.Literal(true),
}) {}

export class AdminUser extends Schema.Class<AdminUser>('AdminUser')({
    id: SafeId,
    username: NonEmpty,
    email: Email,
    displayName: NonEmpty,
    isAdmin: Schema.Boolean,
    disabledAt: Schema.NullOr(Timestamp),
    createdAt: Timestamp,
    passkeyCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    subscriptionCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}) {}

export class AdminAccessLink extends Schema.Class<AdminAccessLink>(
    'AdminAccessLink',
)({
    id: SafeId,
    userId: SafeId,
    username: NonEmpty,
    purpose: Schema.Literals(['enrollment', 'recovery']),
    expiresAt: Timestamp,
    consumedAt: Schema.NullOr(Timestamp),
    revokedAt: Schema.NullOr(Timestamp),
    createdAt: Timestamp,
}) {}

export class AdminSecurityEvent extends Schema.Class<AdminSecurityEvent>(
    'AdminSecurityEvent',
)({
    id: SafeId,
    userId: Schema.NullOr(SafeId),
    actorUserId: Schema.NullOr(SafeId),
    kind: NonEmpty,
    createdAt: Timestamp,
}) {}

export class AdminOverviewResponse extends Schema.Class<AdminOverviewResponse>(
    'AdminOverviewResponse',
)({
    users: Schema.Array(AdminUser).check(Schema.isMaxLength(100)),
    accessLinks: Schema.Array(AdminAccessLink).check(Schema.isMaxLength(100)),
    securityEvents: Schema.Array(AdminSecurityEvent).check(
        Schema.isMaxLength(100),
    ),
}) {}

export class UpdateAdminUserRequest extends Schema.Class<UpdateAdminUserRequest>(
    'UpdateAdminUserRequest',
)({
    disabled: Schema.Boolean,
}) {}

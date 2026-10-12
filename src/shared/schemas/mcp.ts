import { Schema } from 'effect';

const Timestamp = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

/**
 * OAuth scopes an MCP client can hold. `mcp:read` covers every read tool;
 * `mcp:write` adds the tools that change reader state or subscriptions.
 */
export const McpScope = Schema.Literals(['mcp:read', 'mcp:write']);
export type McpScope = typeof McpScope.Type;

/** One MCP client the user authorized, as listed on the settings page. */
export class McpConnectedClient extends Schema.Class<McpConnectedClient>(
    'McpConnectedClient',
)({
    grantId: NonEmptyString,
    clientId: NonEmptyString,
    /** Self-asserted by the client unless `clientDomain` is set. */
    clientName: NonEmptyString,
    /** Verified domain of a Client ID Metadata Document client. */
    clientDomain: Schema.NullOr(NonEmptyString),
    scopes: Schema.Array(Schema.String),
    createdAt: Timestamp,
    expiresAt: Schema.NullOr(Timestamp),
}) {}

export class McpSettingsResponse extends Schema.Class<McpSettingsResponse>(
    'McpSettingsResponse',
)({
    enabled: Schema.Boolean,
    /** The URL users paste into an MCP client. */
    endpointUrl: NonEmptyString,
    clients: Schema.Array(McpConnectedClient).check(Schema.isMaxLength(100)),
}) {}

export class UpdateMcpSettingsRequest extends Schema.Class<UpdateMcpSettingsRequest>(
    'UpdateMcpSettingsRequest',
)({
    enabled: Schema.Boolean,
}) {}

import { ApiErrorResponse } from '@shared/http';
import { McpSettingsResponse } from '@shared/schemas/mcp';
import { Effect, Schema } from 'effect';

export type McpSettings = typeof McpSettingsResponse.Type;
export type McpConnectedClient = McpSettings['clients'][number];

export class McpClientError extends Error {
    readonly _tag = 'McpClientError';

    constructor(
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'McpClientError';
    }
}

interface RequestOptions {
    readonly method?: 'GET' | 'PUT' | 'DELETE';
    readonly body?: unknown;
    readonly csrfToken?: string;
}

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new McpClientError(
                    `The MCP settings service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new McpClientError(error.message, response.status, error.code),
        }),
    );

/** Every MCP settings endpoint answers with the current settings. */
const requestSettings = (
    path: string,
    options: RequestOptions = {},
): Effect.Effect<McpSettings, McpClientError> =>
    Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(path, {
                    method: options.method ?? 'GET',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        ...(options.method === undefined ||
                        options.method === 'GET'
                            ? {}
                            : { 'Content-Type': 'application/json' }),
                        ...(options.csrfToken === undefined
                            ? {}
                            : { 'X-CSRF-Token': options.csrfToken }),
                    },
                    ...(options.body === undefined
                        ? {}
                        : { body: JSON.stringify(options.body) }),
                    signal,
                }),
            catch: (cause) =>
                new McpClientError(
                    'The MCP settings service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });
        const body: unknown = yield* Effect.tryPromise({
            try: () => response.json(),
            catch: (cause) =>
                new McpClientError(
                    'The MCP settings service returned invalid JSON.',
                    response.status,
                    undefined,
                    cause,
                ),
        });
        if (!response.ok) {
            return yield* Effect.fail(yield* statusError(response, body));
        }
        return yield* Schema.decodeUnknownEffect(McpSettingsResponse)(
            body,
        ).pipe(
            Effect.mapError(
                (cause) =>
                    new McpClientError(
                        'The MCP settings response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const getMcpSettings = Effect.fn('McpClient.get')(() =>
    requestSettings('/api/mcp'),
);

export const updateMcpSettings = Effect.fn('McpClient.update')(
    (input: { readonly enabled: boolean; readonly csrfToken: string }) =>
        requestSettings('/api/mcp', {
            method: 'PUT',
            body: { enabled: input.enabled },
            csrfToken: input.csrfToken,
        }),
);

export const disconnectMcpClient = Effect.fn('McpClient.disconnect')(
    (input: { readonly grantId: string; readonly csrfToken: string }) =>
        requestSettings(
            `/api/mcp/clients/${encodeURIComponent(input.grantId)}`,
            { method: 'DELETE', csrfToken: input.csrfToken },
        ),
);

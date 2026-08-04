import {
    ApiErrorResponse,
    FaviconRefreshResponse,
    RefreshCommandResponse,
} from '@shared/http';
import {
    CategoryMutationResponse,
    type CreateCategoryRequest,
    type CreateSubscriptionRequest,
    CreateSubscriptionResponse,
    DeleteResourceResponse,
    SubscriptionManagementResponse,
    SubscriptionMutationResponse,
    type UpdateCategoryRequest,
    type UpdateSubscriptionRequest,
} from '@shared/schemas/subscriptions';
import { Effect, Schema } from 'effect';

export type SubscriptionManagement = typeof SubscriptionManagementResponse.Type;
export type ManagedCategory = SubscriptionManagement['categories'][number];
export type ManagedSubscription =
    SubscriptionManagement['subscriptions'][number];
export type SubscriptionRefreshRecord =
    ManagedSubscription['refreshes'][number];
export type SubscriptionFilterRules = ManagedSubscription['filterRules'];
export type RefreshCommand = typeof RefreshCommandResponse.Type;
export type FaviconRefresh = typeof FaviconRefreshResponse.Type;

export interface CreateCategoryInput {
    readonly name: typeof CreateCategoryRequest.Type.name;
    readonly csrfToken: string;
}

export interface UpdateCategoryInput {
    readonly categoryId: number;
    readonly name: typeof UpdateCategoryRequest.Type.name;
    readonly csrfToken: string;
}

export interface DeleteCategoryInput {
    readonly categoryId: number;
    readonly csrfToken: string;
}

export type CreateSubscriptionInput = {
    readonly feedUrl: typeof CreateSubscriptionRequest.Type.feedUrl;
    readonly csrfToken: string;
} & (
    | {
          readonly categoryId: number;
          readonly categoryName?: never;
      }
    | {
          readonly categoryId?: never;
          readonly categoryName: string;
      }
);

export interface UpdateSubscriptionInput {
    readonly feedId: number;
    readonly categoryId: typeof UpdateSubscriptionRequest.Type.categoryId;
    readonly customFeedName: typeof UpdateSubscriptionRequest.Type.customFeedName;
    readonly filterRules: typeof UpdateSubscriptionRequest.Type.filterRules;
    readonly csrfToken: string;
}

export interface UnsubscribeInput {
    readonly feedId: number;
    readonly csrfToken: string;
}

export interface RefreshSubscriptionInput {
    readonly feedId: number;
    readonly csrfToken: string;
}

export type SubscriptionClientErrorKind = 'transport' | 'status' | 'decode';

export class SubscriptionClientError extends Error {
    readonly _tag = 'SubscriptionClientError';

    constructor(
        readonly kind: SubscriptionClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'SubscriptionClientError';
    }
}

interface JsonRequestOptions {
    readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    readonly body?: unknown;
    readonly csrfToken?: string;
    readonly idempotencyKey?: string;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new SubscriptionClientError(
                'decode',
                'The subscription service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new SubscriptionClientError(
                    'status',
                    `The subscription service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new SubscriptionClientError(
                    'status',
                    error.message,
                    response.status,
                    error.code,
                ),
        }),
    );

const requestJson = <A>(
    path: string,
    schema: Schema.Decoder<A, never>,
    options: JsonRequestOptions = {},
): Effect.Effect<A, SubscriptionClientError> =>
    Effect.gen(function* () {
        const response = yield* Effect.tryPromise({
            try: (signal) =>
                fetch(path, {
                    method: options.method ?? 'GET',
                    credentials: 'same-origin',
                    headers: {
                        Accept: 'application/json',
                        ...(options.body === undefined
                            ? {}
                            : { 'Content-Type': 'application/json' }),
                        ...(options.csrfToken === undefined
                            ? {}
                            : { 'X-CSRF-Token': options.csrfToken }),
                        ...(options.idempotencyKey === undefined
                            ? {}
                            : { 'Idempotency-Key': options.idempotencyKey }),
                    },
                    ...(options.body === undefined
                        ? {}
                        : { body: JSON.stringify(options.body) }),
                    signal,
                }),
            catch: (cause) =>
                new SubscriptionClientError(
                    'transport',
                    'The subscription service is unavailable.',
                    undefined,
                    undefined,
                    cause,
                ),
        });

        const body = yield* readJson(response);
        if (!response.ok) {
            return yield* Effect.fail(yield* statusError(response, body));
        }

        return yield* Schema.decodeUnknownEffect(schema)(body).pipe(
            Effect.mapError(
                (cause) =>
                    new SubscriptionClientError(
                        'decode',
                        'The subscription response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const listManagedSubscriptions = Effect.fn(
    'SubscriptionClient.listManaged',
)(() =>
    requestJson('/api/subscriptions/manage', SubscriptionManagementResponse),
);

export const createCategory = Effect.fn('SubscriptionClient.createCategory')(
    (input: CreateCategoryInput) =>
        requestJson('/api/categories', CategoryMutationResponse, {
            method: 'POST',
            body: {
                name: input.name,
            } satisfies typeof CreateCategoryRequest.Type,
            csrfToken: input.csrfToken,
        }),
);

export const updateCategory = Effect.fn('SubscriptionClient.updateCategory')(
    (input: UpdateCategoryInput) =>
        requestJson(
            `/api/categories/${input.categoryId}`,
            CategoryMutationResponse,
            {
                method: 'PATCH',
                body: {
                    name: input.name,
                } satisfies typeof UpdateCategoryRequest.Type,
                csrfToken: input.csrfToken,
            },
        ),
);

export const deleteCategory = Effect.fn('SubscriptionClient.deleteCategory')(
    (input: DeleteCategoryInput) =>
        requestJson(
            `/api/categories/${input.categoryId}`,
            DeleteResourceResponse,
            { method: 'DELETE', csrfToken: input.csrfToken },
        ),
);

export const createSubscription = Effect.fn(
    'SubscriptionClient.createSubscription',
)((input: CreateSubscriptionInput) =>
    requestJson('/api/subscriptions', CreateSubscriptionResponse, {
        method: 'POST',
        body: {
            feedUrl: input.feedUrl,
            ...(input.categoryId === undefined
                ? { categoryName: input.categoryName }
                : { categoryId: input.categoryId }),
        } satisfies typeof CreateSubscriptionRequest.Type,
        csrfToken: input.csrfToken,
    }),
);

export const updateSubscription = Effect.fn(
    'SubscriptionClient.updateSubscription',
)((input: UpdateSubscriptionInput) =>
    requestJson(
        `/api/subscriptions/${input.feedId}`,
        SubscriptionMutationResponse,
        {
            method: 'PATCH',
            body: {
                categoryId: input.categoryId,
                customFeedName: input.customFeedName,
                filterRules: input.filterRules,
            } satisfies typeof UpdateSubscriptionRequest.Type,
            csrfToken: input.csrfToken,
        },
    ),
);

export const unsubscribe = Effect.fn('SubscriptionClient.unsubscribe')(
    (input: UnsubscribeInput) =>
        requestJson(
            `/api/subscriptions/${input.feedId}`,
            DeleteResourceResponse,
            { method: 'DELETE', csrfToken: input.csrfToken },
        ),
);

export const refreshSubscription = Effect.fn(
    'SubscriptionClient.refreshSubscription',
)((input: RefreshSubscriptionInput) =>
    requestJson(`/api/feeds/${input.feedId}/refresh`, RefreshCommandResponse, {
        method: 'POST',
        body: {},
        csrfToken: input.csrfToken,
        idempotencyKey: crypto.randomUUID(),
    }),
);

export const refreshFavicon = Effect.fn('SubscriptionClient.refreshFavicon')(
    (input: RefreshSubscriptionInput) =>
        requestJson(
            `/api/feeds/${input.feedId}/favicon/refresh`,
            FaviconRefreshResponse,
            {
                method: 'POST',
                body: {},
                csrfToken: input.csrfToken,
            },
        ),
);

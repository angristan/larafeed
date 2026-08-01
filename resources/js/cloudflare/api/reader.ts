import {
    ApiErrorResponse,
    ReaderCategoryListResponse,
    ReaderCountsResponse,
    ReaderEntryDetail,
    ReaderEntryListResponse,
    type ReaderFilter,
    ReaderInteractionResponse,
    type ReaderOrder,
    ReaderReadThroughResponse,
    ReaderSubscriptionListResponse,
} from '@shared/http';
import { Effect, Schema } from 'effect';

export type ReaderCategoryList = typeof ReaderCategoryListResponse.Type;
export type ReaderSubscriptionList = typeof ReaderSubscriptionListResponse.Type;
export type ReaderCounts = typeof ReaderCountsResponse.Type;
export type ReaderEntryPage = typeof ReaderEntryListResponse.Type;
export type ReaderEntry = typeof ReaderEntryDetail.Type;
export type ReaderInteraction = typeof ReaderInteractionResponse.Type;
export type ReaderReadThrough = typeof ReaderReadThroughResponse.Type;

export interface ReaderEntryListInput {
    readonly feedId: number | null;
    readonly categoryId: number | null;
    readonly filter: ReaderFilter;
    readonly orderBy: ReaderOrder;
    readonly page: number;
    readonly pageSize: number;
}

export interface DesiredReadInput {
    readonly entryId: number;
    readonly read: boolean;
    readonly csrfToken: string;
}

export interface DesiredStarInput {
    readonly entryId: number;
    readonly starred: boolean;
    readonly csrfToken: string;
}

export interface DesiredArchiveInput {
    readonly entryId: number;
    readonly archived: boolean;
    readonly csrfToken: string;
}

export interface ReadThroughInput {
    readonly feedId: number;
    readonly csrfToken: string;
}

export type ReaderClientErrorKind = 'transport' | 'status' | 'decode';

export class ReaderClientError extends Error {
    readonly _tag = 'ReaderClientError';

    constructor(
        readonly kind: ReaderClientErrorKind,
        message: string,
        readonly status?: number,
        readonly code?: typeof ApiErrorResponse.Type.error.code,
        cause?: unknown,
    ) {
        super(message, { cause });
        this.name = 'ReaderClientError';
    }
}

interface JsonRequestOptions {
    readonly method?: 'GET' | 'PUT';
    readonly body?: Readonly<Record<string, boolean>>;
    readonly csrfToken?: string;
}

const readJson = (response: Response) =>
    Effect.tryPromise({
        try: async () => {
            const json: unknown = await response.json();
            return json;
        },
        catch: (cause) =>
            new ReaderClientError(
                'decode',
                'The reader service returned invalid JSON.',
                response.status,
                undefined,
                cause,
            ),
    });

const statusError = (response: Response, body: unknown) =>
    Schema.decodeUnknownEffect(ApiErrorResponse)(body).pipe(
        Effect.match({
            onFailure: () =>
                new ReaderClientError(
                    'status',
                    `The reader service returned status ${response.status}.`,
                    response.status,
                ),
            onSuccess: ({ error }) =>
                new ReaderClientError(
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
): Effect.Effect<A, ReaderClientError> =>
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
                    },
                    ...(options.body === undefined
                        ? {}
                        : { body: JSON.stringify(options.body) }),
                    signal,
                }),
            catch: (cause) =>
                new ReaderClientError(
                    'transport',
                    'The reader service is unavailable.',
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
                    new ReaderClientError(
                        'decode',
                        'The reader response has an invalid shape.',
                        response.status,
                        undefined,
                        cause,
                    ),
            ),
        );
    });

export const listCategories = Effect.fn('ReaderClient.listCategories')(() =>
    requestJson('/api/categories', ReaderCategoryListResponse),
);

export const listSubscriptions = Effect.fn('ReaderClient.listSubscriptions')(
    () => requestJson('/api/subscriptions', ReaderSubscriptionListResponse),
);

export const getReaderCounts = Effect.fn('ReaderClient.getCounts')(() =>
    requestJson('/api/entries/counts', ReaderCountsResponse),
);

export const listEntries = Effect.fn('ReaderClient.listEntries')(
    (input: ReaderEntryListInput) => {
        const search = new URLSearchParams({
            filter: input.filter,
            order_by: input.orderBy,
            page: input.page.toString(),
            page_size: input.pageSize.toString(),
        });

        if (input.feedId !== null) {
            search.set('feed_id', input.feedId.toString());
        } else if (input.categoryId !== null) {
            search.set('category_id', input.categoryId.toString());
        }

        return requestJson(
            `/api/entries?${search.toString()}`,
            ReaderEntryListResponse,
        );
    },
);

export const getEntry = Effect.fn('ReaderClient.getEntry')((entryId: number) =>
    requestJson(`/api/entries/${entryId}`, ReaderEntryDetail),
);

export const setEntryRead = Effect.fn('ReaderClient.setEntryRead')(
    (input: DesiredReadInput) =>
        requestJson(
            `/api/entries/${input.entryId}/read`,
            ReaderInteractionResponse,
            {
                method: 'PUT',
                body: { read: input.read },
                csrfToken: input.csrfToken,
            },
        ),
);

export const setEntryStarred = Effect.fn('ReaderClient.setEntryStarred')(
    (input: DesiredStarInput) =>
        requestJson(
            `/api/entries/${input.entryId}/star`,
            ReaderInteractionResponse,
            {
                method: 'PUT',
                body: { starred: input.starred },
                csrfToken: input.csrfToken,
            },
        ),
);

export const setEntryArchived = Effect.fn('ReaderClient.setEntryArchived')(
    (input: DesiredArchiveInput) =>
        requestJson(
            `/api/entries/${input.entryId}/archive`,
            ReaderInteractionResponse,
            {
                method: 'PUT',
                body: { archived: input.archived },
                csrfToken: input.csrfToken,
            },
        ),
);

export const markFeedReadThrough = Effect.fn(
    'ReaderClient.markFeedReadThrough',
)((input: ReadThroughInput) =>
    requestJson(
        `/api/subscriptions/${input.feedId}/read-through`,
        ReaderReadThroughResponse,
        {
            method: 'PUT',
            body: {},
            csrfToken: input.csrfToken,
        },
    ),
);

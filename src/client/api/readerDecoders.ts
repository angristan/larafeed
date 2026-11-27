import {
    ReaderCategory,
    ReaderCountsResponse,
    ReaderEntry,
    ReaderEntryDetail,
    ReaderEntryListResponse,
    ReaderSubscription,
} from '@shared/schemas/reader';
import { Effect, Schema } from 'effect';

import { ReaderClientError } from './readerError';
import type { ReaderJsonResponse } from './readerRequest';

// The shared schemas decode to Schema.Class instances. TanStack Query only
// shares structure between plain objects and arrays, so class instances made
// every refetch replace every row and defeated memoized rows. These structs
// reuse the same fields and decode to plain objects instead.
const ReaderCategoryListPlain = Schema.Struct({
    categories: Schema.Array(Schema.Struct(ReaderCategory.fields)),
});
const ReaderSubscriptionListPlain = Schema.Struct({
    subscriptions: Schema.Array(Schema.Struct(ReaderSubscription.fields)),
});
const ReaderCountsPlain = Schema.Struct(ReaderCountsResponse.fields);
const ReaderEntryPagePlain = Schema.Struct({
    ...ReaderEntryListResponse.fields,
    entries: Schema.Array(Schema.Struct(ReaderEntry.fields)),
});
const ReaderEntryDetailPlain = Schema.Struct(ReaderEntryDetail.fields);

export type ReaderCategoryListData = typeof ReaderCategoryListPlain.Type;
export type ReaderSubscriptionListData =
    typeof ReaderSubscriptionListPlain.Type;
export type ReaderCountsData = typeof ReaderCountsPlain.Type;
export type ReaderEntryPageData = typeof ReaderEntryPagePlain.Type;
export type ReaderEntryDetailData = typeof ReaderEntryDetailPlain.Type;

const decode =
    <A>(schema: Schema.Decoder<A, never>) =>
    ({ body, status }: ReaderJsonResponse): Promise<A> =>
        Effect.runPromise(
            Schema.decodeUnknownEffect(schema)(body).pipe(
                Effect.mapError(
                    (cause) =>
                        new ReaderClientError(
                            'decode',
                            'The reader response has an invalid shape.',
                            status,
                            undefined,
                            cause,
                        ),
                ),
            ),
        );

export const decodeReaderCategoryList = decode(ReaderCategoryListPlain);
export const decodeReaderSubscriptionList = decode(ReaderSubscriptionListPlain);
export const decodeReaderCounts = decode(ReaderCountsPlain);
export const decodeReaderEntryPage = decode(ReaderEntryPagePlain);
export const decodeReaderEntry = decode(ReaderEntryDetailPlain);

import {
    ReaderCategoryListResponse,
    ReaderCountsResponse,
    ReaderEntryDetail,
    ReaderEntryListResponse,
    ReaderSubscriptionListResponse,
} from '@shared/schemas/reader';
import { Effect, Schema } from 'effect';

import { ReaderClientError } from './readerError';
import type { ReaderJsonResponse } from './readerRequest';

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

export const decodeReaderCategoryList = decode(ReaderCategoryListResponse);
export const decodeReaderSubscriptionList = decode(
    ReaderSubscriptionListResponse,
);
export const decodeReaderCounts = decode(ReaderCountsResponse);
export const decodeReaderEntryPage = decode(ReaderEntryListResponse);
export const decodeReaderEntry = decode(ReaderEntryDetail);

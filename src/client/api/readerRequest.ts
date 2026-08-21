import type { ReaderEntryListInput } from './reader';
import { ReaderClientError } from './readerError';

export interface ReaderJsonResponse {
    readonly body: unknown;
    readonly status: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export function readerEntryListPath(input: ReaderEntryListInput): string {
    const search = new URLSearchParams({
        filter: input.filter,
        order_by: input.orderBy,
        page_size: input.pageSize.toString(),
    });
    if (input.cursor !== null) search.set('cursor', input.cursor);

    if (input.feedId !== null) {
        search.set('feed_id', input.feedId.toString());
    } else if (input.categoryId !== null) {
        search.set('category_id', input.categoryId.toString());
    }

    return `/api/entries?${search.toString()}`;
}

export async function fetchReaderJson(
    path: string,
    signal: AbortSignal,
): Promise<ReaderJsonResponse> {
    let response: Response;
    try {
        response = await fetch(path, {
            method: 'GET',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
            signal,
        });
    } catch (cause) {
        if (signal.aborted) throw cause;
        throw new ReaderClientError(
            'transport',
            'The reader service is unavailable.',
            undefined,
            undefined,
            cause,
        );
    }

    let body: unknown;
    try {
        body = await response.json();
    } catch (cause) {
        throw new ReaderClientError(
            'decode',
            'The reader service returned invalid JSON.',
            response.status,
            undefined,
            cause,
        );
    }

    if (!response.ok) {
        const error =
            isRecord(body) && isRecord(body.error) ? body.error : null;
        const message =
            error !== null && typeof error.message === 'string'
                ? error.message
                : `The reader service returned status ${response.status}.`;
        throw new ReaderClientError('status', message, response.status);
    }

    return { body, status: response.status };
}

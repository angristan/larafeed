const defaultHeaders = {
    Accept: 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
};

export class HttpError<T = unknown> extends Error {
    status: number;
    data: T | undefined;

    constructor(status: number, data: T | undefined) {
        super(`Request failed with status ${status}`);
        this.name = 'HttpError';
        this.status = status;
        this.data = data;
    }
}

async function parseResponseData<T>(
    response: Response,
): Promise<T | undefined> {
    const contentType = response.headers.get('content-type');

    if (!contentType?.includes('application/json')) {
        return undefined;
    }

    return (await response.json()) as T;
}

async function request<TResponse>(
    input: RequestInfo | URL,
    init?: RequestInit,
): Promise<TResponse | undefined> {
    const response = await fetch(input, {
        credentials: 'same-origin',
        ...init,
        headers: {
            ...defaultHeaders,
            ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
            ...init?.headers,
        },
    });
    const data = await parseResponseData<TResponse>(response);

    if (!response.ok) {
        throw new HttpError(response.status, data);
    }

    return data;
}

export function getJson<TResponse>(
    input: RequestInfo | URL,
): Promise<TResponse | undefined> {
    return request<TResponse>(input);
}

export function postJson<TResponse, TBody = unknown>(
    input: RequestInfo | URL,
    body?: TBody,
): Promise<TResponse | undefined> {
    return request<TResponse>(input, {
        method: 'POST',
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

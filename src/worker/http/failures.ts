import { Cause, Effect } from 'effect';

const safeFailureTag = (value: unknown): string => {
    if (typeof value !== 'object' || value === null) return 'Unknown';
    const candidate = Reflect.get(value, '_tag') ?? Reflect.get(value, 'name');
    return typeof candidate === 'string' &&
        /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(candidate)
        ? candidate
        : 'Unknown';
};

const expectedUnavailableTags = new Set([
    'FaviconRefreshDisabled',
    'OpmlFeatureDisabled',
    'SummaryFeatureDisabled',
]);

const failureTags = (cause: Cause.Cause<unknown>): string[] => {
    const tags = new Set<string>();
    for (const reason of cause.reasons) {
        if (Cause.isFailReason(reason)) tags.add(safeFailureTag(reason.error));
        if (Cause.isDieReason(reason)) tags.add(safeFailureTag(reason.defect));
    }
    return [...tags].sort().slice(0, 4);
};

const reportCause = (
    cause: Cause.Cause<unknown>,
    tags: readonly string[],
): void => {
    console.error({
        event: 'http.request.failed',
        failureKind: Cause.hasDies(cause) ? 'defect' : 'typed_failure',
        failureTags: tags,
        reasonCount: Math.min(cause.reasons.length, 10),
    });
};

export const recoverHttpCause = (
    cause: Cause.Cause<unknown>,
    response: (error: unknown) => Response,
): Effect.Effect<Response, unknown> => {
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);

    const result = response(Cause.squash(cause));
    const tags = failureTags(cause);
    const isExpectedUnavailable =
        result.status === 503 &&
        tags.length > 0 &&
        tags.every((tag) => expectedUnavailableTags.has(tag));
    if (result.status >= 500 && !isExpectedUnavailable) {
        reportCause(cause, tags);
    }
    return Effect.succeed(result);
};

export const isCancellationError = (error: unknown): boolean => {
    if (typeof error !== 'object' || error === null) return false;
    const name = Reflect.get(error, 'name');
    const message = Reflect.get(error, 'message');
    return (
        name === 'AbortError' ||
        name === 'InterruptedException' ||
        (name === 'Error' && message === 'All fibers interrupted without error')
    );
};

export const reportUnexpectedHttpError = (error: unknown): void => {
    if (isCancellationError(error)) return;
    console.error({
        event: 'http.request.failed',
        failureKind: 'exception',
        failureTags: [safeFailureTag(error)],
        reasonCount: 1,
    });
};

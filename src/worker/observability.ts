import { tracing } from 'cloudflare:workers';

export const operationNames = {
    opmlQueue: 'app.opml.queue.consume',
    refreshQueue: 'app.refresh.queue.consume',
    faviconQueue: 'app.favicon.queue.consume',
    refreshCron: 'app.refresh.cron',
    opmlCron: 'app.opml.cron',
    faviconCron: 'app.favicon.cron',
} as const;

export const spanNames = {
    httpFailure: 'app.http.failure',
    queueDecision: 'app.queue.decision',
    jobFailure: 'app.job.failure',
    dispatchFailure: 'app.queue.dispatch.failure',
    cronResult: 'app.cron.result',
    faviconPageFetch: 'app.favicon.page.fetch',
    faviconManifestFetch: 'app.favicon.manifest.fetch',
    faviconCandidateFetch: 'app.favicon.candidate.fetch',
    faviconAssetPersist: 'app.favicon.asset.persist',
} as const;

export type OperationName =
    (typeof operationNames)[keyof typeof operationNames];
export type TelemetrySpanName =
    | OperationName
    | (typeof spanNames)[keyof typeof spanNames];
export type OperationTrigger = 'queue' | 'scheduled';
export type TelemetryValue = boolean | number | string;
export type TelemetryAttributes = Readonly<
    Record<string, TelemetryValue | undefined>
>;

export interface OperationAttributes {
    readonly batchSize?: number;
}

export interface TelemetryFailure {
    readonly errorClass: string;
    readonly stage?: string;
    readonly retryable?: boolean;
    readonly httpStatus?: number;
}

interface TraceOptions {
    readonly logFailure?: boolean;
}

const ERROR_CLASS = /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/u;
const ATTRIBUTE_KEY = /^app\.[a-z][a-z0-9_.]{0,95}$/u;
const ATTRIBUTE_STRING = /^[A-Za-z0-9][A-Za-z0-9_.,+/-]{0,127}$/u;

export const safeErrorClass = (value: unknown): string => {
    if (typeof value !== 'object' || value === null) return 'Unknown';
    try {
        const candidate =
            Reflect.get(value, '_tag') ?? Reflect.get(value, 'name');
        return typeof candidate === 'string' && ERROR_CLASS.test(candidate)
            ? candidate
            : 'Unknown';
    } catch {
        return 'Unknown';
    }
};

const definedAttributes = (
    attributes: TelemetryAttributes,
): Record<string, TelemetryValue> =>
    Object.fromEntries(
        Object.entries(attributes).filter(
            (entry): entry is [string, TelemetryValue] => {
                const value = entry[1];
                return (
                    ATTRIBUTE_KEY.test(entry[0]) &&
                    value !== undefined &&
                    (typeof value === 'boolean' ||
                        (typeof value === 'number' && Number.isFinite(value)) ||
                        (typeof value === 'string' &&
                            ATTRIBUTE_STRING.test(value)))
                );
            },
        ),
    );

const setAttributes = (span: Span, attributes: TelemetryAttributes): void => {
    for (const [key, value] of Object.entries(definedAttributes(attributes)))
        span.setAttribute(key, value);
};

const failureAttributes = (failure: TelemetryFailure): TelemetryAttributes => ({
    'app.failure.class': failure.errorClass,
    'app.failure.stage': failure.stage,
    'app.failure.retryable': failure.retryable,
    'app.failure.http_status': failure.httpStatus,
});

const markFailure = (
    span: Span,
    attributes: TelemetryAttributes,
    failure: TelemetryFailure,
): void => {
    span.setAttribute('app.outcome', 'failed');
    setAttributes(span, attributes);
    setAttributes(span, failureAttributes(failure));
};

const logFailure = (
    name: TelemetrySpanName,
    attributes: TelemetryAttributes,
    failure: TelemetryFailure,
): void => {
    console.error({
        event: 'app.operation.failed',
        operation: name,
        outcome: 'failed',
        ...definedAttributes(attributes),
        ...definedAttributes(failureAttributes(failure)),
    });
};

export const traceAsync = <A>(
    name: TelemetrySpanName,
    attributes: TelemetryAttributes,
    operation: (span: Span) => Promise<A>,
    classifyFailure: (cause: unknown) => TelemetryFailure = (cause) => ({
        errorClass: safeErrorClass(cause),
    }),
    options: TraceOptions = {},
): Promise<A> =>
    tracing.enterSpan(name, async (span) => {
        setAttributes(span, attributes);
        try {
            const result = await operation(span);
            span.setAttribute('app.outcome', 'succeeded');
            return result;
        } catch (cause) {
            const failure = classifyFailure(cause);
            markFailure(span, attributes, failure);
            if (options.logFailure !== false)
                logFailure(name, attributes, failure);
            throw cause;
        }
    });

export const recordHandledFailure = (
    name: TelemetrySpanName,
    attributes: TelemetryAttributes,
    failure: TelemetryFailure,
): void => {
    tracing.enterSpan(name, (span) => {
        markFailure(span, attributes, failure);
        logFailure(name, attributes, failure);
    });
};

export const recordCronResult = (
    subsystem: 'favicon' | 'opml' | 'refresh',
    attributes: TelemetryAttributes,
    degraded = false,
): void => {
    tracing.enterSpan(spanNames.cronResult, (span) => {
        const combined = { 'app.subsystem': subsystem, ...attributes };
        setAttributes(span, combined);
        span.setAttribute('app.outcome', degraded ? 'degraded' : 'succeeded');
        if (degraded) {
            console.warn({
                event: 'app.cron.degraded',
                ...definedAttributes(combined),
            });
        }
    });
};

export const recordQueueDecision = (
    subsystem: 'favicon' | 'opml' | 'refresh',
    decision:
        | { readonly action: 'ack' | 'dead'; readonly reason: string }
        | {
              readonly action: 'retry';
              readonly reason: string;
              readonly retryDelaySeconds: number;
          },
): void => {
    const attributes: TelemetryAttributes = {
        'app.subsystem': subsystem,
        'app.queue.action': decision.action,
        'app.queue.reason': decision.reason,
        'app.queue.retry_delay_seconds':
            decision.action === 'retry'
                ? Math.max(1, Math.trunc(decision.retryDelaySeconds))
                : undefined,
    };
    tracing.enterSpan(spanNames.queueDecision, (span) => {
        setAttributes(span, attributes);
        span.setAttribute(
            'app.outcome',
            decision.action === 'ack'
                ? 'succeeded'
                : decision.action === 'retry'
                  ? 'retrying'
                  : 'discarded',
        );
        if (decision.action !== 'ack') {
            console.warn({
                event: 'app.queue.decision',
                ...definedAttributes(attributes),
            });
        }
    });
};

export const traceOperation = <A>(
    name: OperationName,
    trigger: OperationTrigger,
    attributes: OperationAttributes,
    operation: () => Promise<A>,
): Promise<A> =>
    traceAsync(
        name,
        {
            'app.trigger': trigger,
            'app.batch.size': attributes.batchSize,
        },
        async () => operation(),
    );

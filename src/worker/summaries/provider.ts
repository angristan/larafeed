import { Effect, Schema } from 'effect';

import type { EnabledSummaryConfig } from './config';
import { SummaryProviderError } from './errors';

export const SUMMARY_PROVIDER_DEADLINE_MS = 15_000;
export const SUMMARY_MAX_OUTPUT_TOKENS = 512;
export const SUMMARY_MAX_PROVIDER_BODY_BYTES = 64_000;

const WorkersAiResponse = Schema.Struct({
    response: Schema.String,
});

export interface GenerateSummaryInput {
    readonly title: string;
    readonly articleText: string;
}

// Structural subset of the generated `Ai` binding type; keeps unit tests and
// call sites decoupled from the model-name literal union in worker-configuration.
export interface SummaryModelRunner {
    run(
        model: string,
        inputs: Record<string, unknown>,
        options?: Record<string, unknown>,
    ): Promise<unknown>;
}

export interface SummaryProvider {
    readonly generate: (
        input: GenerateSummaryInput,
    ) => Effect.Effect<string, SummaryProviderError>;
}

interface AttemptFailure {
    readonly kind:
        | 'transport'
        | 'timeout'
        | 'rate_limited'
        | 'unavailable'
        | 'rejected'
        | 'invalid_response'
        | 'output_too_large';
    readonly retryable: boolean;
}

const attemptFailure = (
    kind: AttemptFailure['kind'],
    retryable: boolean,
): AttemptFailure => ({ kind, retryable });

const isAttemptFailure = (value: unknown): value is AttemptFailure =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'kind') === 'string' &&
    typeof Reflect.get(value, 'retryable') === 'boolean';

// Binding errors surface as thrown Errors; classify without preserving the
// provider message so upstream details never reach clients or logs.
const classifyRunError = (cause: unknown): AttemptFailure => {
    const message = cause instanceof Error ? cause.message.toLowerCase() : '';
    if (message.includes('rate limit') || message.includes('429')) {
        return attemptFailure('rate_limited', true);
    }
    if (message.includes('capacity') || message.includes('unavailable')) {
        return attemptFailure('unavailable', true);
    }
    return attemptFailure('transport', true);
};

const prompt = (
    input: GenerateSummaryInput,
): string => `Summarize the following article in 3-4 sentences. Break your summary into short paragraphs using HTML <p> tags. If the article appears to be an aggregator post or excerpt, mention that. Use passive voice. Return HTML only, no markdown.

Title: ${input.title}
Content: ${input.articleText}`;

const utf8 = new TextEncoder();

const requestAttempt = async (
    config: EnabledSummaryConfig,
    ai: SummaryModelRunner,
    input: GenerateSummaryInput,
    outerSignal: AbortSignal,
    deadline: number,
): Promise<string> => {
    const remaining = Math.max(0, deadline - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
            () => reject(attemptFailure('timeout', true)),
            remaining,
        );
    });

    try {
        let output: unknown;
        try {
            output = await Promise.race([
                ai.run(
                    config.model,
                    {
                        messages: [{ role: 'user', content: prompt(input) }],
                        max_tokens: SUMMARY_MAX_OUTPUT_TOKENS,
                        temperature: 0.2,
                    },
                    {
                        gateway: {
                            id: config.gatewayName,
                            skipCache: true,
                        },
                    },
                ),
                timedOut,
            ]);
        } catch (cause) {
            if (isAttemptFailure(cause)) throw cause;
            if (outerSignal.aborted) throw cause;
            throw classifyRunError(cause);
        }

        let decoded: typeof WorkersAiResponse.Type;
        try {
            decoded = Schema.decodeUnknownSync(WorkersAiResponse)(output);
        } catch {
            throw attemptFailure('invalid_response', false);
        }
        const text = decoded.response.trim();
        if (text.length === 0) {
            throw attemptFailure('invalid_response', false);
        }
        if (utf8.encode(text).byteLength > SUMMARY_MAX_PROVIDER_BODY_BYTES) {
            throw attemptFailure('output_too_large', false);
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
};

export const makeSummaryProvider = (
    config: EnabledSummaryConfig,
    ai: SummaryModelRunner,
): SummaryProvider => ({
    generate: (input) =>
        Effect.tryPromise({
            try: async (signal) => {
                const deadline = Date.now() + SUMMARY_PROVIDER_DEADLINE_MS;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    try {
                        return await requestAttempt(
                            config,
                            ai,
                            input,
                            signal,
                            deadline,
                        );
                    } catch (cause) {
                        if (
                            isAttemptFailure(cause) &&
                            cause.retryable &&
                            attempt === 0 &&
                            Date.now() < deadline
                        ) {
                            continue;
                        }
                        throw cause;
                    }
                }
                throw attemptFailure('unavailable', false);
            },
            catch: (cause) => {
                const failure = isAttemptFailure(cause)
                    ? cause
                    : attemptFailure('transport', false);
                return new SummaryProviderError({ kind: failure.kind });
            },
        }),
});

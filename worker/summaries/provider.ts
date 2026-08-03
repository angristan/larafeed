import { Effect, Schema } from 'effect';

import type { SummaryConfig } from './config';
import { SummaryProviderError } from './errors';

export const SUMMARY_PROVIDER_DEADLINE_MS = 15_000;
export const SUMMARY_MAX_OUTPUT_TOKENS = 512;
export const SUMMARY_MAX_PROVIDER_BODY_BYTES = 64_000;

const GeminiResponse = Schema.Struct({
    candidates: Schema.Array(
        Schema.Struct({
            content: Schema.Struct({
                parts: Schema.Array(
                    Schema.Struct({
                        text: Schema.String,
                    }),
                ),
            }),
        }),
    ),
});

export interface GenerateSummaryInput {
    readonly title: string;
    readonly articleText: string;
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
    readonly status?: number;
    readonly retryable: boolean;
}

const attemptFailure = (
    kind: AttemptFailure['kind'],
    retryable: boolean,
    status?: number,
): AttemptFailure => ({
    kind,
    retryable,
    ...(status === undefined ? {} : { status }),
});

const isAttemptFailure = (value: unknown): value is AttemptFailure =>
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'kind') === 'string' &&
    typeof Reflect.get(value, 'retryable') === 'boolean';

const gatewayUrl = (config: SummaryConfig): string =>
    `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(config.accountId)}/${encodeURIComponent(config.gatewayName)}/google-ai-studio/v1beta/models/${encodeURIComponent(config.model)}:generateContent`;

const prompt = (
    input: GenerateSummaryInput,
): string => `Summarize the following article in 3-4 sentences. Break your summary into short paragraphs using HTML <p> tags. If the article appears to be an aggregator post or excerpt, mention that. Use passive voice. Return HTML only, no markdown.

Title: ${input.title}
Content: ${input.articleText}`;

const readBoundedText = async (
    response: Response,
    signal: AbortSignal,
): Promise<string> => {
    const declaredLength = response.headers.get('content-length');
    if (
        declaredLength !== null &&
        /^\d+$/u.test(declaredLength) &&
        Number(declaredLength) > SUMMARY_MAX_PROVIDER_BODY_BYTES
    ) {
        throw attemptFailure('output_too_large', false, response.status);
    }

    if (response.body === null) return '';
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    try {
        while (true) {
            if (signal.aborted) throw signal.reason;
            const chunk = await reader.read();
            if (chunk.done) break;
            total += chunk.value.byteLength;
            if (total > SUMMARY_MAX_PROVIDER_BODY_BYTES) {
                await reader.cancel();
                throw attemptFailure(
                    'output_too_large',
                    false,
                    response.status,
                );
            }
            chunks.push(chunk.value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
};

const requestAttempt = async (
    config: SummaryConfig,
    input: GenerateSummaryInput,
    outerSignal: AbortSignal,
    deadline: number,
): Promise<string> => {
    const timeout = new AbortController();
    const remaining = Math.max(0, deadline - Date.now());
    const timer = setTimeout(
        () => timeout.abort(new DOMException('Timed out', 'TimeoutError')),
        remaining,
    );
    const signal = AbortSignal.any([outerSignal, timeout.signal]);

    try {
        let response: Response;
        try {
            response = await fetch(gatewayUrl(config), {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': config.apiKey,
                    'cf-aig-collect-log': 'false',
                    'cf-aig-skip-cache': 'true',
                },
                body: JSON.stringify({
                    contents: [
                        {
                            role: 'user',
                            parts: [{ text: prompt(input) }],
                        },
                    ],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
                        responseMimeType: 'text/plain',
                    },
                }),
                signal,
            });
        } catch (cause) {
            if (outerSignal.aborted) throw cause;
            if (timeout.signal.aborted) {
                throw attemptFailure('timeout', true);
            }
            throw attemptFailure('transport', true);
        }

        if (!response.ok) {
            if (response.status === 429) {
                throw attemptFailure('rate_limited', true, response.status);
            }
            if (response.status >= 500) {
                throw attemptFailure('unavailable', true, response.status);
            }
            throw attemptFailure('rejected', false, response.status);
        }

        const encoded = await readBoundedText(response, signal);
        let json: unknown;
        try {
            json = JSON.parse(encoded);
        } catch {
            throw attemptFailure('invalid_response', false, response.status);
        }

        let decoded: typeof GeminiResponse.Type;
        try {
            decoded = Schema.decodeUnknownSync(GeminiResponse)(json);
        } catch {
            throw attemptFailure('invalid_response', false, response.status);
        }
        const text = decoded.candidates
            .flatMap((candidate) => candidate.content.parts)
            .map((part) => part.text)
            .join('\n')
            .trim();
        if (text.length === 0) {
            throw attemptFailure('invalid_response', false, response.status);
        }
        return text;
    } finally {
        clearTimeout(timer);
    }
};

export const makeSummaryProvider = (
    config: SummaryConfig,
): SummaryProvider => ({
    generate: (input) =>
        Effect.tryPromise({
            try: async (signal) => {
                const deadline = Date.now() + SUMMARY_PROVIDER_DEADLINE_MS;
                for (let attempt = 0; attempt < 2; attempt += 1) {
                    try {
                        return await requestAttempt(
                            config,
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
                return new SummaryProviderError({
                    kind: failure.kind,
                    ...(failure.status === undefined
                        ? {}
                        : { status: failure.status }),
                });
            },
        }),
});

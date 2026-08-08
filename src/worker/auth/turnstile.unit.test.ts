import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';

import {
    makeTurnstileValidator,
    TURNSTILE_SITEVERIFY_URL,
    TurnstileInputError,
    TurnstileRejectedError,
    TurnstileRequestError,
    TurnstileResponseError,
} from './turnstile';

const expectedHostname = 'larafeed.stanislas.cloud';
const secretKey = 'private-turnstile-secret';
const token = 'client-turnstile-token';

const successResponse = (overrides: Record<string, unknown> = {}) =>
    Response.json({
        success: true,
        challenge_ts: '2026-07-18T12:00:00.000Z',
        hostname: expectedHostname,
        action: 'passkey_authentication',
        ...overrides,
    });

const bodyEntries = (init?: RequestInit): Record<string, string> => {
    const body = init?.body;
    expect(body).toBeInstanceOf(URLSearchParams);

    if (!(body instanceof URLSearchParams)) {
        throw new Error('Expected URLSearchParams request body');
    }

    return Object.fromEntries(body.entries());
};

const errorText = (error: Error): string =>
    `${error.message} ${JSON.stringify(error)} ${Object.getOwnPropertyNames(
        error,
    ).join(' ')}`;

describe('Turnstile Siteverify validator', () => {
    it('posts all required form fields and returns only validated metadata', async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                successResponse(),
        );
        const validator = makeTurnstileValidator({
            secretKey,
            expectedHostname,
            fetch: fetchMock,
        });

        const verification = await Effect.runPromise(
            validator.verify({
                token,
                remoteIp: '203.0.113.42',
                expectedAction: 'passkey_authentication',
            }),
        );

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
        expect(init).toMatchObject({
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
            },
        });

        const body = bodyEntries(init);
        expect(body).toMatchObject({
            secret: secretKey,
            response: token,
            remoteip: '203.0.113.42',
        });
        expect(body.idempotency_key).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
        );
        expect(verification).toEqual({
            hostname: expectedHostname,
            action: 'passkey_authentication',
            challengeTimestamp: '2026-07-18T12:00:00.000Z',
        });
        expect(verification).not.toHaveProperty('token');
    });

    it('omits remoteip when Cloudflare did not provide one', async () => {
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, _init?: RequestInit) =>
                successResponse(),
        );
        const validator = makeTurnstileValidator({
            secretKey,
            expectedHostname,
            fetch: fetchMock,
        });

        await Effect.runPromise(
            validator.verify({
                token,
                expectedAction: 'passkey_authentication',
            }),
        );

        expect(bodyEntries(fetchMock.mock.calls[0][1])).not.toHaveProperty(
            'remoteip',
        );
    });

    it('retries transport and 5xx failures with one idempotency UUID', async () => {
        const requestBodies: Record<string, string>[] = [];
        let attempt = 0;
        const fetchMock = vi.fn(
            async (_input: RequestInfo | URL, init?: RequestInit) => {
                requestBodies.push(bodyEntries(init));
                attempt += 1;

                if (attempt === 1) {
                    throw new Error('network unavailable');
                }
                if (attempt === 2) {
                    return new Response('temporary', { status: 503 });
                }
                return successResponse();
            },
        );
        const validator = makeTurnstileValidator({
            secretKey,
            expectedHostname,
            fetch: fetchMock,
        });

        await Effect.runPromise(
            validator.verify({
                token,
                expectedAction: 'passkey_authentication',
            }),
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(
            new Set(requestBodies.map((body) => body.idempotency_key)).size,
        ).toBe(1);
    });

    it('bounds transport retries at three total attempts', async () => {
        const fetchMock = vi.fn(async () => {
            throw new Error(`transport failed for ${token} and ${secretKey}`);
        });
        const validator = makeTurnstileValidator({
            secretKey,
            expectedHostname,
            fetch: fetchMock,
        });

        const error = await Effect.runPromise(
            Effect.flip(
                validator.verify({
                    token,
                    expectedAction: 'passkey_authentication',
                }),
            ),
        );

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(TurnstileRequestError);
        expect(error).toMatchObject({ kind: 'transport' });
        expect(error).not.toHaveProperty('cause');
        expect(errorText(error)).not.toContain(token);
        expect(errorText(error)).not.toContain(secretKey);
    });

    it('does not retry terminal HTTP or response decoding failures', async () => {
        const cases = [
            {
                response: () => new Response('forbidden', { status: 403 }),
                errorClass: TurnstileRequestError,
                expected: { kind: 'http', status: 403 },
            },
            {
                response: () => new Response('{', { status: 200 }),
                errorClass: TurnstileResponseError,
                expected: { reason: 'invalid_json' },
            },
            {
                response: () => Response.json({ success: 'yes' }),
                errorClass: TurnstileResponseError,
                expected: { reason: 'invalid_schema' },
            },
        ];

        for (const testCase of cases) {
            const fetchMock = vi.fn(async () => testCase.response());
            const validator = makeTurnstileValidator({
                secretKey,
                expectedHostname,
                fetch: fetchMock,
            });

            const error = await Effect.runPromise(
                Effect.flip(
                    validator.verify({
                        token,
                        expectedAction: 'passkey_authentication',
                    }),
                ),
            );

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(error).toBeInstanceOf(testCase.errorClass);
            expect(error).toMatchObject(testCase.expected);
        }
    });

    it.each([
        [
            'provider rejection',
            {
                success: false,
                'error-codes': ['timeout-or-duplicate'],
            },
            'provider_rejected',
        ],
        [
            'hostname mismatch',
            { hostname: 'attacker.example' },
            'hostname_mismatch',
        ],
        ['action mismatch', { action: 'other_action' }, 'action_mismatch'],
    ])(
        'rejects %s after a decoded response',
        async (_, responseOverrides, reason) => {
            const fetchMock = vi.fn(async () =>
                successResponse(responseOverrides),
            );
            const validator = makeTurnstileValidator({
                secretKey,
                expectedHostname,
                fetch: fetchMock,
            });

            const error = await Effect.runPromise(
                Effect.flip(
                    validator.verify({
                        token,
                        expectedAction: 'passkey_authentication',
                    }),
                ),
            );

            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(error).toBeInstanceOf(Error);
            expect(error).toBeInstanceOf(TurnstileRejectedError);
            expect(error).toMatchObject({ reason });
            expect(errorText(error)).not.toContain(token);
            expect(errorText(error)).not.toContain(secretKey);
        },
    );

    it('rejects invalid metadata before any subrequest', async () => {
        const cases = [
            {
                input: { token, expectedAction: '' },
                field: 'expectedAction',
            },
            {
                input: {
                    token,
                    remoteIp: 'x'.repeat(129),
                    expectedAction: 'passkey_authentication',
                },
                field: 'remoteIp',
            },
        ];

        for (const testCase of cases) {
            const fetchMock = vi.fn(async () => successResponse());
            const validator = makeTurnstileValidator({
                secretKey,
                expectedHostname,
                fetch: fetchMock,
            });

            const error = await Effect.runPromise(
                Effect.flip(validator.verify(testCase.input)),
            );

            expect(fetchMock).not.toHaveBeenCalled();
            expect(error).toBeInstanceOf(TurnstileInputError);
            expect(error).toMatchObject({
                field: testCase.field,
                reason: 'invalid',
            });
        }
    });

    it('rejects empty and overlong tokens before any subrequest', async () => {
        for (const invalidToken of ['', 'x'.repeat(2049)]) {
            const fetchMock = vi.fn(async () => successResponse());
            const validator = makeTurnstileValidator({
                secretKey,
                expectedHostname,
                fetch: fetchMock,
            });

            const error = await Effect.runPromise(
                Effect.flip(
                    validator.verify({
                        token: invalidToken,
                        expectedAction: 'passkey_authentication',
                    }),
                ),
            );

            expect(fetchMock).not.toHaveBeenCalled();
            expect(error).toBeInstanceOf(TurnstileInputError);
            expect(error).toMatchObject({
                field: 'token',
                reason: invalidToken === '' ? 'invalid' : 'too_long',
            });
            if (invalidToken !== '') {
                expect(errorText(error)).not.toContain(invalidToken);
            }
        }
    });
});

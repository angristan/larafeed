import {
    forwardRef,
    type ReactElement,
    useEffect,
    useImperativeHandle,
    useRef,
} from 'react';

const TURNSTILE_SCRIPT_ID = 'larafeed-turnstile-script';
const TURNSTILE_SCRIPT_URL =
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileRenderOptions {
    readonly sitekey: string;
    readonly action: string;
    readonly execution: 'execute';
    readonly appearance: 'interaction-only';
    readonly callback: (token: string) => void;
    readonly 'error-callback': (code: string) => void;
    readonly 'expired-callback': () => void;
    readonly 'timeout-callback': () => void;
}

interface TurnstileApi {
    readonly render: (
        container: HTMLElement,
        options: TurnstileRenderOptions,
    ) => string;
    readonly execute: (widgetId: string) => void;
    readonly reset: (widgetId: string) => void;
    readonly remove: (widgetId: string) => void;
}

declare global {
    interface Window {
        turnstile?: TurnstileApi;
    }
}

let scriptPromise: Promise<TurnstileApi> | undefined;

export class TurnstileError extends Error {
    readonly _tag = 'TurnstileError';

    constructor(
        readonly kind: 'script' | 'challenge' | 'expired' | 'timeout' | 'busy',
        message: string,
    ) {
        super(message);
        this.name = 'TurnstileError';
    }
}

function loadTurnstile(): Promise<TurnstileApi> {
    if (window.turnstile !== undefined) {
        return Promise.resolve(window.turnstile);
    }

    if (scriptPromise !== undefined) {
        return scriptPromise;
    }

    scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
        const existingScript = document.getElementById(
            TURNSTILE_SCRIPT_ID,
        ) as HTMLScriptElement | null;
        const script = existingScript ?? document.createElement('script');

        const handleLoad = () => {
            if (window.turnstile === undefined) {
                scriptPromise = undefined;
                reject(
                    new TurnstileError(
                        'script',
                        'Human verification did not initialize.',
                    ),
                );
                return;
            }

            resolve(window.turnstile);
        };

        const handleError = () => {
            scriptPromise = undefined;
            reject(
                new TurnstileError(
                    'script',
                    'Human verification could not be loaded.',
                ),
            );
        };

        script.addEventListener('load', handleLoad, { once: true });
        script.addEventListener('error', handleError, { once: true });

        if (existingScript === null) {
            script.id = TURNSTILE_SCRIPT_ID;
            script.src = TURNSTILE_SCRIPT_URL;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }
    });

    return scriptPromise;
}

export interface TurnstileHandle {
    readonly execute: (action: string) => Promise<string>;
}

export function executeTurnstile(
    handle: TurnstileHandle | null,
    siteKey: string | null,
    action: string,
): Promise<string | undefined> {
    if (siteKey === null) {
        return Promise.resolve(undefined);
    }
    if (handle === null) {
        return Promise.reject(
            new TurnstileError('script', 'Human verification is not ready.'),
        );
    }

    return handle.execute(action);
}

interface TurnstileProps {
    readonly siteKey: string;
}

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(
    function Turnstile({ siteKey }, ref): ReactElement {
        const containerRef = useRef<HTMLDivElement>(null);
        const widgetIdRef = useRef<string | undefined>(undefined);
        const pendingRef = useRef<
            | {
                  readonly id: symbol;
                  readonly reject: (error: TurnstileError) => void;
              }
            | undefined
        >(undefined);

        useEffect(
            () => () => {
                pendingRef.current?.reject(
                    new TurnstileError(
                        'challenge',
                        'Human verification was interrupted.',
                    ),
                );
                pendingRef.current = undefined;

                const widgetId = widgetIdRef.current;
                const api = window.turnstile;
                if (widgetId !== undefined && api !== undefined) {
                    api.reset(widgetId);
                    api.remove(widgetId);
                }
                widgetIdRef.current = undefined;
            },
            [],
        );

        useImperativeHandle(
            ref,
            () => ({
                execute: async (action) => {
                    if (pendingRef.current !== undefined) {
                        throw new TurnstileError(
                            'busy',
                            'Human verification is already in progress.',
                        );
                    }

                    const api = await loadTurnstile();
                    const container = containerRef.current;
                    if (container === null) {
                        throw new TurnstileError(
                            'script',
                            'Human verification is not available.',
                        );
                    }

                    const previousWidgetId = widgetIdRef.current;
                    if (previousWidgetId !== undefined) {
                        api.reset(previousWidgetId);
                        api.remove(previousWidgetId);
                        widgetIdRef.current = undefined;
                    }

                    return new Promise<string>((resolve, reject) => {
                        const requestId = Symbol(action);
                        pendingRef.current = { id: requestId, reject };

                        const finish = (result: string | TurnstileError) => {
                            if (pendingRef.current?.id !== requestId) {
                                return;
                            }

                            pendingRef.current = undefined;
                            if (typeof result === 'string') {
                                resolve(result);
                            } else {
                                reject(result);
                            }
                        };

                        const widgetId = api.render(container, {
                            sitekey: siteKey,
                            action,
                            execution: 'execute',
                            appearance: 'interaction-only',
                            callback: (token) => finish(token),
                            'error-callback': () =>
                                finish(
                                    new TurnstileError(
                                        'challenge',
                                        'Human verification failed. Try again.',
                                    ),
                                ),
                            'expired-callback': () =>
                                finish(
                                    new TurnstileError(
                                        'expired',
                                        'Human verification expired. Try again.',
                                    ),
                                ),
                            'timeout-callback': () =>
                                finish(
                                    new TurnstileError(
                                        'timeout',
                                        'Human verification timed out. Try again.',
                                    ),
                                ),
                        });

                        widgetIdRef.current = widgetId;
                        api.execute(widgetId);
                    });
                },
            }),
            [siteKey],
        );

        return <div ref={containerRef} aria-live="polite" />;
    },
);

const span = {
    isTraced: false,
    setAttribute: () => undefined,
    end: () => undefined,
} as unknown as Span;

export const tracing = {
    enterSpan: <A, Args extends unknown[]>(
        _name: string,
        callback: (current: Span, ...args: Args) => A,
        ...args: Args
    ): A => callback(span, ...args),
    startActiveSpan: <A, Args extends unknown[]>(
        _name: string,
        callback: (current: Span, ...args: Args) => A,
        ...args: Args
    ): A => callback(span, ...args),
    Span: class {},
};

// `@cloudflare/workers-oauth-provider` imports this base class to recognize
// entrypoint handlers. Unit tests never construct one.
export class WorkerEntrypoint {}

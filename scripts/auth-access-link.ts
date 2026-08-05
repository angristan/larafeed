#!/usr/bin/env bun

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

type InitialAdminInput = {
    readonly mode: 'initial-admin';
    readonly username: string;
    readonly email: string;
    readonly displayName: string;
};

type RecoverAdminInput = {
    readonly mode: 'recover-admin';
    readonly userId: number;
};

type OperatorInput = InitialAdminInput | RecoverAdminInput;

const fail = (message: string): never => {
    throw new Error(message);
};

const required = (value: string | undefined, option: string): string => {
    if (value === undefined || value.length === 0) {
        return fail(`Missing required --${option}`);
    }
    return value;
};

const endpointUrl = (value: string | undefined): URL => {
    const urlValue = required(value, 'url');
    let url: URL;
    try {
        url = new URL(urlValue);
    } catch {
        return fail('Invalid --url');
    }

    const localHttp =
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '[::1]');
    if (url.protocol !== 'https:' && !localHttp) {
        return fail('--url must use HTTPS, except for a local endpoint');
    }
    if (url.username !== '' || url.password !== '' || url.hash !== '') {
        return fail('--url must not contain credentials or a fragment');
    }
    return url;
};

const readHiddenOperatorSecret = async (): Promise<string> => {
    const input = process.stdin;
    if (
        !input.isTTY ||
        !process.stdout.isTTY ||
        input.setRawMode === undefined
    ) {
        return fail(
            'LARAFEED_OPERATOR_SECRET must be set for non-interactive use',
        );
    }

    process.stdout.write('Operator secret: ');
    const wasRaw = input.isRaw;
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.resume();

    return await new Promise<string>((resolve, reject) => {
        let secret = '';

        const cleanup = (): void => {
            input.removeListener('data', onData);
            input.setRawMode(wasRaw);
            input.pause();
            process.stdout.write('\n');
        };

        const finish = (): void => {
            cleanup();
            resolve(secret);
        };

        const onData = (chunk: string): void => {
            for (const character of chunk) {
                if (character === '\u0003') {
                    cleanup();
                    reject(new Error('Operator secret input cancelled'));
                    return;
                }
                if (character === '\r' || character === '\n') {
                    finish();
                    return;
                }
                if (character === '\u007f' || character === '\b') {
                    secret = secret.slice(0, -1);
                    continue;
                }
                if (character >= ' ' && secret.length < 4096) {
                    secret += character;
                }
            }
        };

        input.on('data', onData);
    });
};

export const resolveOperatorSecret = async (options?: {
    readonly secret?: string;
    readonly interactive?: boolean;
    readonly prompt?: () => Promise<string>;
}): Promise<string> => {
    const secret = options?.secret ?? process.env.LARAFEED_OPERATOR_SECRET;
    if (secret !== undefined && secret.length > 0) {
        return secret;
    }

    const interactive =
        options?.interactive ??
        (process.stdin.isTTY === true && process.stdout.isTTY === true);
    if (!interactive) {
        return fail(
            'LARAFEED_OPERATOR_SECRET must be set for non-interactive use',
        );
    }

    const promptedSecret = await (
        options?.prompt ?? readHiddenOperatorSecret
    )();
    if (promptedSecret.length === 0) {
        return fail('Operator secret must not be empty');
    }
    return promptedSecret;
};

const operatorInput = (values: {
    readonly mode?: string;
    readonly username?: string;
    readonly email?: string;
    readonly 'display-name'?: string;
    readonly 'user-id'?: string;
}): OperatorInput => {
    switch (values.mode) {
        case 'initial-admin':
            if (values['user-id'] !== undefined) {
                return fail(
                    '--user-id is only valid with --mode recover-admin',
                );
            }
            return {
                mode: 'initial-admin',
                username: required(values.username, 'username'),
                email: required(values.email, 'email'),
                displayName: required(values['display-name'], 'display-name'),
            };
        case 'recover-admin': {
            if (
                values.username !== undefined ||
                values.email !== undefined ||
                values['display-name'] !== undefined
            ) {
                return fail(
                    '--username, --email, and --display-name are only valid with --mode initial-admin',
                );
            }
            const rawUserId = required(values['user-id'], 'user-id');
            const userId = Number(rawUserId);
            if (!Number.isSafeInteger(userId) || userId <= 0) {
                return fail('--user-id must be a positive safe integer');
            }
            return { mode: 'recover-admin', userId };
        }
        default:
            return fail(
                '--mode must be explicitly set to initial-admin or recover-admin',
            );
    }
};

const main = async (): Promise<void> => {
    const { values } = parseArgs({
        args: Bun.argv.slice(2),
        allowPositionals: false,
        strict: true,
        options: {
            url: { type: 'string' },
            mode: { type: 'string' },
            username: { type: 'string' },
            email: { type: 'string' },
            'display-name': { type: 'string' },
            'user-id': { type: 'string' },
        },
    });

    const url = endpointUrl(values.url);
    const input = operatorInput(values);
    const operatorSecret = await resolveOperatorSecret();

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${operatorSecret}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
        return fail(`Operator endpoint returned HTTP ${response.status}`);
    }

    const result: unknown = await response.json();
    if (
        typeof result !== 'object' ||
        result === null ||
        typeof Reflect.get(result, 'url') !== 'string'
    ) {
        return fail('Operator endpoint returned an invalid response');
    }

    console.log(Reflect.get(result, 'url'));
};

const scriptPath = process.argv[1];
if (
    scriptPath !== undefined &&
    import.meta.url === pathToFileURL(scriptPath).href
) {
    try {
        await main();
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'Unknown error';
        console.error(`auth-access-link: ${message}`);
        process.exitCode = 1;
    }
}

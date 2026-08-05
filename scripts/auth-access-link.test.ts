import { describe, expect, it, vi } from 'vitest';
import { resolveOperatorSecret } from './auth-access-link';

describe('resolveOperatorSecret', () => {
    it('uses an injected environment secret without prompting', async () => {
        const prompt = vi.fn<() => Promise<string>>();

        await expect(
            resolveOperatorSecret({
                secret: 'injected-secret',
                interactive: true,
                prompt,
            }),
        ).resolves.toBe('injected-secret');
        expect(prompt).not.toHaveBeenCalled();
    });

    it('prompts when the environment secret is absent in a terminal', async () => {
        const prompt = vi.fn(async () => 'prompted-secret');

        await expect(
            resolveOperatorSecret({ secret: '', interactive: true, prompt }),
        ).resolves.toBe('prompted-secret');
        expect(prompt).toHaveBeenCalledOnce();
    });

    it('rejects an empty prompted secret', async () => {
        await expect(
            resolveOperatorSecret({
                secret: '',
                interactive: true,
                prompt: async () => '',
            }),
        ).rejects.toThrow('Operator secret must not be empty');
    });

    it('requires environment injection outside a terminal', async () => {
        const prompt = vi.fn<() => Promise<string>>();

        await expect(
            resolveOperatorSecret({
                secret: '',
                interactive: false,
                prompt,
            }),
        ).rejects.toThrow(
            'LARAFEED_OPERATOR_SECRET must be set for non-interactive use',
        );
        expect(prompt).not.toHaveBeenCalled();
    });
});

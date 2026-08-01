import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
} from '@simplewebauthn/server';
import { describe, expect, it } from 'vitest';

describe('SimpleWebAuthn Workerd compatibility', () => {
    it('generates environment-bound passkey ceremony options', async () => {
        const authentication = await generateAuthenticationOptions({
            rpID: 'larafeed-test.stanislas.cloud',
            userVerification: 'required',
        });
        const registration = await generateRegistrationOptions({
            rpName: 'Larafeed Test',
            rpID: 'larafeed-test.stanislas.cloud',
            userID: new Uint8Array(32).fill(7),
            userName: 'owner',
            userDisplayName: 'Owner',
            attestationType: 'none',
            authenticatorSelection: {
                residentKey: 'required',
                userVerification: 'required',
            },
        });

        expect(authentication.rpId).toBe('larafeed-test.stanislas.cloud');
        expect(authentication.userVerification).toBe('required');
        expect(authentication.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
        expect(registration.rp.id).toBe('larafeed-test.stanislas.cloud');
        expect(registration.authenticatorSelection).toMatchObject({
            residentKey: 'required',
            userVerification: 'required',
        });
        expect(registration.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
    });
});

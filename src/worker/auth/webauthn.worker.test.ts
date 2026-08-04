import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeWebAuthn } from './webauthn';

const webAuthn = makeWebAuthn();

describe('WebAuthn Workerd compatibility', () => {
    it('generates discoverable environment-bound passkey options', async () => {
        const authentication = await Effect.runPromise(
            webAuthn.authenticationOptions({
                rpId: 'larafeed-test.stanislas.cloud',
            }),
        );
        const registration = await Effect.runPromise(
            webAuthn.registrationOptions({
                rpName: 'Larafeed Test',
                rpId: 'larafeed-test.stanislas.cloud',
                user: {
                    handle: new Uint8Array(32).fill(7),
                    username: 'owner',
                    displayName: 'Owner',
                },
                excludeCredentials: [],
            }),
        );

        expect(authentication.rpId).toBe('larafeed-test.stanislas.cloud');
        expect(authentication.userVerification).toBe('required');
        expect(authentication.allowCredentials ?? []).toEqual([]);
        expect(authentication.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
        expect(registration.rp).toMatchObject({
            id: 'larafeed-test.stanislas.cloud',
        });
        expect(registration.authenticatorSelection).toMatchObject({
            residentKey: 'required',
            userVerification: 'required',
        });
        expect(registration.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
    });
});

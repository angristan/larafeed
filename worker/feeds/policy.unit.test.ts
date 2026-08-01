import { describe, expect, it } from 'vitest';

import { FeedPolicyError } from './errors';
import { validateFeedUrl } from './policy';

const rejected = (url: string, reason: FeedPolicyError['reason']) => {
    try {
        validateFeedUrl(url);
        throw new Error('Expected URL rejection');
    } catch (error) {
        expect(error).toBeInstanceOf(FeedPolicyError);
        expect(error).toMatchObject({ reason });
    }
};

describe('feed URL policy', () => {
    it('accepts public HTTP and HTTPS URLs', () => {
        expect(validateFeedUrl('https://feeds.example.com/rss').href).toBe(
            'https://feeds.example.com/rss',
        );
        expect(validateFeedUrl('http://8.8.8.8/feed').href).toBe(
            'http://8.8.8.8/feed',
        );
        expect(
            validateFeedUrl('https://[2606:4700:4700::1111]/feed').href,
        ).toBe('https://[2606:4700:4700::1111]/feed');
    });

    it.each([
        ['ftp://feeds.example.com/rss', 'unsupported_protocol'],
        ['https://user:secret@feeds.example.com/rss', 'credentials_forbidden'],
        ['https://feeds.example.com/rss#fragment', 'fragment_forbidden'],
        ['https://feeds.example.com:8443/rss', 'nonstandard_port'],
        ['http://localhost/feed', 'forbidden_hostname'],
        ['http://service/feed', 'forbidden_hostname'],
        ['http://printer.local/feed', 'forbidden_hostname'],
        ['http://127.0.0.1/feed', 'forbidden_ip_address'],
        ['http://2130706433/feed', 'forbidden_ip_address'],
        ['http://10.2.3.4/feed', 'forbidden_ip_address'],
        ['http://169.254.169.254/feed', 'forbidden_ip_address'],
        ['http://172.31.0.1/feed', 'forbidden_ip_address'],
        ['http://192.168.1.1/feed', 'forbidden_ip_address'],
        ['http://192.0.2.1/feed', 'forbidden_ip_address'],
        ['http://224.0.0.1/feed', 'forbidden_ip_address'],
        ['http://[::1]/feed', 'forbidden_ip_address'],
        ['http://[::ffff:127.0.0.1]/feed', 'forbidden_ip_address'],
        ['http://[::ffff:8.8.8.8]/feed', 'forbidden_ip_address'],
        ['http://[2001:2::1]/feed', 'forbidden_ip_address'],
        ['http://[3fff::1]/feed', 'forbidden_ip_address'],
        ['http://[fc00::1]/feed', 'forbidden_ip_address'],
        ['http://[fe80::1]/feed', 'forbidden_ip_address'],
        ['http://[2001:db8::1]/feed', 'forbidden_ip_address'],
    ] as const)('rejects %s', (url, reason) => rejected(url, reason));
});

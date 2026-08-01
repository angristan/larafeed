import { FeedPolicyError } from './errors';

const STANDARD_PORTS: Readonly<Record<string, string>> = {
    'http:': '80',
    'https:': '443',
};

const forbiddenIpv4Ranges: readonly (readonly [number, number])[] = [
    [0x00000000, 0x00ffffff],
    [0x0a000000, 0x0affffff],
    [0x64400000, 0x647fffff],
    [0x7f000000, 0x7fffffff],
    [0xa9fe0000, 0xa9feffff],
    [0xac100000, 0xac1fffff],
    [0xc0000000, 0xc00000ff],
    [0xc0000200, 0xc00002ff],
    [0xc01fc400, 0xc01fc4ff],
    [0xc034c100, 0xc034c1ff],
    [0xc0586300, 0xc05863ff],
    [0xc0a80000, 0xc0a8ffff],
    [0xc0af3000, 0xc0af30ff],
    [0xc6120000, 0xc613ffff],
    [0xc6336400, 0xc63364ff],
    [0xcb007100, 0xcb0071ff],
    [0xe0000000, 0xffffffff],
];

const ipv4Number = (hostname: string): number | undefined => {
    const parts = hostname.split('.');
    if (parts.length !== 4) {
        return undefined;
    }

    let result = 0;
    for (const part of parts) {
        if (!/^\d{1,3}$/u.test(part)) {
            return undefined;
        }
        const octet = Number(part);
        if (octet > 255) {
            return undefined;
        }
        result = result * 256 + octet;
    }

    return result;
};

const parseIpv6 = (hostname: string): readonly number[] | undefined => {
    const unwrapped =
        hostname.startsWith('[') && hostname.endsWith(']')
            ? hostname.slice(1, -1)
            : hostname;
    if (!unwrapped.includes(':') || unwrapped.includes('%')) {
        return undefined;
    }

    let value = unwrapped.toLowerCase();
    const embeddedIpv4 = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(value);
    if (embeddedIpv4 !== null) {
        const ipv4 = ipv4Number(embeddedIpv4[1]);
        if (ipv4 === undefined) {
            return undefined;
        }
        value = `${value.slice(0, -embeddedIpv4[1].length)}${(
            (ipv4 >>> 16) & 0xffff
        ).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
    }

    if ((value.match(/::/gu) ?? []).length > 1) {
        return undefined;
    }

    const [leftText, rightText] = value.split('::');
    const left = leftText === '' ? [] : leftText.split(':');
    const right =
        rightText === undefined || rightText === '' ? [] : rightText.split(':');
    if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) {
        return undefined;
    }

    const omitted = 8 - left.length - right.length;
    if (
        (rightText === undefined && omitted !== 0) ||
        (rightText !== undefined && omitted < 1)
    ) {
        return undefined;
    }

    return [
        ...left.map((part) => Number.parseInt(part, 16)),
        ...Array.from({ length: omitted }, () => 0),
        ...right.map((part) => Number.parseInt(part, 16)),
    ];
};

const isForbiddenIpv4 = (address: number): boolean =>
    forbiddenIpv4Ranges.some(
        ([start, end]) => address >= start && address <= end,
    );

const isForbiddenIpv6 = (parts: readonly number[]): boolean => {
    // IPv4-mapped addresses are special-purpose IPv6 literals, including when
    // the embedded IPv4 address itself would otherwise be public.
    if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
        return true;
    }

    // Only globally routable 2000::/3 addresses are accepted. IETF protocol
    // assignments and documentation ranges within that space remain forbidden.
    const globallyRoutable =
        (parts[0] ?? 0) >= 0x2000 && (parts[0] ?? 0) <= 0x3fff;
    const protocolAssignments =
        parts[0] === 0x2001 && (parts[1] ?? 0) <= 0x01ff;
    const documentation =
        (parts[0] === 0x2001 && parts[1] === 0x0db8) ||
        (parts[0] === 0x3fff && (parts[1] ?? 0) <= 0x0fff);
    return !globallyRoutable || protocolAssignments || documentation;
};

export const validateFeedUrl = (input: string | URL): URL => {
    let url: URL;
    try {
        url = input instanceof URL ? new URL(input.href) : new URL(input);
    } catch {
        throw new FeedPolicyError({ reason: 'invalid_url' });
    }

    if (!(url.protocol in STANDARD_PORTS)) {
        throw new FeedPolicyError({ reason: 'unsupported_protocol' });
    }
    if (url.username !== '' || url.password !== '') {
        throw new FeedPolicyError({ reason: 'credentials_forbidden' });
    }
    if (url.hash !== '') {
        throw new FeedPolicyError({ reason: 'fragment_forbidden' });
    }
    if (url.port !== '' && url.port !== STANDARD_PORTS[url.protocol]) {
        throw new FeedPolicyError({ reason: 'nonstandard_port' });
    }

    const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
    const ipv4 = ipv4Number(hostname);
    if (ipv4 !== undefined) {
        if (isForbiddenIpv4(ipv4)) {
            throw new FeedPolicyError({ reason: 'forbidden_ip_address' });
        }
        return url;
    }

    const ipv6 = parseIpv6(hostname);
    if (ipv6 !== undefined) {
        if (isForbiddenIpv6(ipv6)) {
            throw new FeedPolicyError({ reason: 'forbidden_ip_address' });
        }
        return url;
    }

    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        !hostname.includes('.')
    ) {
        throw new FeedPolicyError({ reason: 'forbidden_hostname' });
    }

    url.hostname = hostname;
    return url;
};

<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Validates URLs against SSRF (Server-Side Request Forgery) attacks.
 *
 * This validator checks that URLs:
 * - Use only http/https schemes
 * - Do not resolve to private, reserved, or loopback IP addresses
 * - Support both IPv4 and IPv6 address validation
 */
class UrlSecurityValidator
{
    /**
     * Validate a URL is safe to fetch (not pointing to internal resources).
     *
     * @return array{valid: bool, error: ?string}
     */
    public static function validate(string $url): array
    {
        $parsed = parse_url($url);

        // Require http/https scheme
        if (! isset($parsed['scheme']) || ! in_array(strtolower($parsed['scheme']), ['http', 'https'], true)) {
            return [
                'valid' => false,
                'error' => 'URL must use HTTP or HTTPS protocol',
            ];
        }

        if (! isset($parsed['host'])) {
            return [
                'valid' => false,
                'error' => 'URL must contain a valid host',
            ];
        }

        $host = $parsed['host'];

        // Remove brackets from IPv6 addresses (e.g., [::1] -> ::1)
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $host = substr($host, 1, -1);
        }

        // Check if host is already an IP address
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            if (self::isUnsafeIp($host)) {
                return [
                    'valid' => false,
                    'error' => 'URL must not point to private or internal addresses',
                ];
            }

            return ['valid' => true, 'error' => null];
        }

        // Resolve hostname to IP addresses (both IPv4 and IPv6)
        $ips = self::resolveHostToIps($host);

        if ($ips === []) {
            // Could not resolve - might be invalid or temporary DNS issue
            // We'll let it fail later during actual fetch rather than blocking here
            return ['valid' => true, 'error' => null];
        }

        foreach ($ips as $ip) {
            if (self::isUnsafeIp($ip)) {
                return [
                    'valid' => false,
                    'error' => 'URL must not point to private or internal addresses',
                ];
            }
        }

        return ['valid' => true, 'error' => null];
    }

    /**
     * Check if a URL is safe to fetch.
     */
    public static function isSafe(string $url): bool
    {
        return self::validate($url)['valid'];
    }

    /**
     * Resolve a hostname to all its IP addresses (IPv4 and IPv6).
     *
     * @return array<string>
     */
    public static function resolveHostToIps(string $host): array
    {
        $ips = [];

        // Get IPv4 addresses (A records)
        $ipv4Addresses = gethostbynamel($host);
        if ($ipv4Addresses !== false) {
            $ips = array_merge($ips, $ipv4Addresses);
        }

        // Get IPv6 addresses (AAAA records)
        $dnsRecords = @dns_get_record($host, DNS_AAAA);
        if ($dnsRecords !== false) {
            foreach ($dnsRecords as $record) {
                if (isset($record['ipv6'])) {
                    $ips[] = $record['ipv6'];
                }
            }
        }

        return array_unique($ips);
    }

    /**
     * Check if an IP address is private, reserved, or otherwise unsafe.
     */
    public static function isUnsafeIp(string $ip): bool
    {
        // Check IPv4
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            // filter_var returns false for private/reserved IPs when these flags are used
            $isPublic = filter_var(
                $ip,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
            );

            return $isPublic === false;
        }

        // Check IPv6
        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6)) {
            // filter_var returns false for private/reserved IPs when these flags are used
            $isPublic = filter_var(
                $ip,
                FILTER_VALIDATE_IP,
                FILTER_FLAG_IPV6 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE
            );

            return $isPublic === false;
        }

        // Invalid IP format - consider it unsafe
        return true;
    }
}

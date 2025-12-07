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
 *
 * DNS Rebinding Protection:
 * The validate() method returns resolved IPs that can be passed to curl via
 * CURLOPT_RESOLVE, ensuring the same IPs validated are used for the actual request.
 * This eliminates the TOCTOU (time-of-check to time-of-use) window that would
 * otherwise allow DNS rebinding attacks.
 */
class UrlSecurityValidator
{
    /**
     * Validate a URL is safe to fetch (not pointing to internal resources).
     *
     * Returns resolved IPs that can be used with CURLOPT_RESOLVE to prevent DNS rebinding.
     *
     * @return array{valid: bool, error: ?string, curl_resolve: array<string>}
     */
    public static function validate(string $url): array
    {
        $parsed = parse_url($url);

        // Require http/https scheme
        if (! isset($parsed['scheme']) || ! in_array(strtolower($parsed['scheme']), ['http', 'https'], true)) {
            return [
                'valid' => false,
                'error' => 'URL must use HTTP or HTTPS protocol',
                'curl_resolve' => [],
            ];
        }

        if (! isset($parsed['host'])) {
            return [
                'valid' => false,
                'error' => 'URL must contain a valid host',
                'curl_resolve' => [],
            ];
        }

        $host = $parsed['host'];
        $scheme = strtolower($parsed['scheme']);
        $port = $parsed['port'] ?? ($scheme === 'https' ? 443 : 80);

        // Remove brackets from IPv6 addresses (e.g., [::1] -> ::1)
        $hostForValidation = $host;
        if (str_starts_with($host, '[') && str_ends_with($host, ']')) {
            $hostForValidation = substr($host, 1, -1);
        }

        // Check if host is already an IP address
        if (filter_var($hostForValidation, FILTER_VALIDATE_IP)) {
            if (self::isUnsafeIp($hostForValidation)) {
                return [
                    'valid' => false,
                    'error' => 'URL must not point to private or internal addresses',
                    'curl_resolve' => [],
                ];
            }

            // No need for CURLOPT_RESOLVE when URL already contains an IP
            return ['valid' => true, 'error' => null, 'curl_resolve' => []];
        }

        // Resolve hostname to IP addresses (both IPv4 and IPv6)
        $ips = self::resolveHostToIps($hostForValidation);

        if ($ips === []) {
            // Could not resolve - might be invalid or temporary DNS issue
            // We'll let it fail later during actual fetch rather than blocking here
            return ['valid' => true, 'error' => null, 'curl_resolve' => []];
        }

        foreach ($ips as $ip) {
            if (self::isUnsafeIp($ip)) {
                return [
                    'valid' => false,
                    'error' => 'URL must not point to private or internal addresses',
                    'curl_resolve' => [],
                ];
            }
        }

        // Build CURLOPT_RESOLVE entries to pin DNS resolution
        // Format: "host:port:ip1,ip2,..."
        $curlResolve = [sprintf('%s:%d:%s', $host, $port, implode(',', $ips))];

        return ['valid' => true, 'error' => null, 'curl_resolve' => $curlResolve];
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
        // Suppress warnings because dns_get_record() emits E_WARNING for common non-error cases:
        // - Host has no AAAA records (only A records)
        // - Temporary DNS server issues
        // - Non-existent domains
        // We handle all these cases gracefully by checking for false below.
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

<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\UrlSecurityValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class UrlSecurityValidatorTest extends TestCase
{
    #[DataProvider('unsafeUrlsProvider')]
    public function test_blocks_unsafe_urls(string $url, string $expectedError): void
    {
        $result = UrlSecurityValidator::validate($url);

        $this->assertFalse($result['valid'], "URL should be blocked: {$url}");
        $this->assertNotNull($result['error']);
    }

    /**
     * @return array<string, array{0: string, 1: string}>
     */
    public static function unsafeUrlsProvider(): array
    {
        return [
            // Non-http schemes
            'ftp scheme' => ['ftp://example.com/feed.xml', 'URL must use HTTP or HTTPS protocol'],
            'file scheme' => ['file:///etc/passwd', 'URL must use HTTP or HTTPS protocol'],
            'javascript scheme' => ['javascript:alert(1)', 'URL must use HTTP or HTTPS protocol'],
            'data scheme' => ['data:text/html,<script>alert(1)</script>', 'URL must use HTTP or HTTPS protocol'],
            'gopher scheme' => ['gopher://localhost:70/', 'URL must use HTTP or HTTPS protocol'],

            // IPv4 private/reserved addresses
            'localhost' => ['http://127.0.0.1/feed.xml', 'URL must not point to private or internal addresses'],
            'loopback range' => ['http://127.0.0.255/feed.xml', 'URL must not point to private or internal addresses'],
            'private 10.x.x.x' => ['http://10.0.0.1/feed.xml', 'URL must not point to private or internal addresses'],
            'private 172.16.x.x' => ['http://172.16.0.1/feed.xml', 'URL must not point to private or internal addresses'],
            'private 192.168.x.x' => ['http://192.168.1.1/feed.xml', 'URL must not point to private or internal addresses'],
            'AWS metadata' => ['http://169.254.169.254/latest/meta-data/', 'URL must not point to private or internal addresses'],
            'link-local' => ['http://169.254.1.1/feed.xml', 'URL must not point to private or internal addresses'],

            // IPv6 private/reserved addresses
            'ipv6 loopback' => ['http://[::1]/feed.xml', 'URL must not point to private or internal addresses'],
            'ipv6 private fc00' => ['http://[fc00::1]/feed.xml', 'URL must not point to private or internal addresses'],
            'ipv6 private fd00' => ['http://[fd00::1]/feed.xml', 'URL must not point to private or internal addresses'],
            'ipv6 link-local' => ['http://[fe80::1]/feed.xml', 'URL must not point to private or internal addresses'],

            // Missing scheme or host
            'no scheme' => ['example.com/feed.xml', 'URL must use HTTP or HTTPS protocol'],
            'empty host' => ['http:///feed.xml', 'URL must contain a valid host'],
        ];
    }

    #[DataProvider('safeUrlsProvider')]
    public function test_allows_safe_urls(string $url): void
    {
        $result = UrlSecurityValidator::validate($url);

        $this->assertTrue($result['valid'], "URL should be allowed: {$url}. Error: {$result['error']}");
        $this->assertNull($result['error']);
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function safeUrlsProvider(): array
    {
        return [
            'http url' => ['http://example.com/feed.xml'],
            'https url' => ['https://example.com/feed.xml'],
            'https with port' => ['https://example.com:8080/feed.xml'],
            'https with path' => ['https://example.com/path/to/feed.xml'],
            'https with query' => ['https://example.com/feed.xml?format=rss'],
            // Public IPs should be allowed
            'public ipv4' => ['http://8.8.8.8/feed.xml'],
            'public ipv4 cloudflare' => ['https://1.1.1.1/'],
        ];
    }

    #[DataProvider('unsafeIpv4Provider')]
    public function test_identifies_unsafe_ipv4_addresses(string $ip): void
    {
        $this->assertTrue(
            UrlSecurityValidator::isUnsafeIp($ip),
            "IP should be identified as unsafe: {$ip}"
        );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function unsafeIpv4Provider(): array
    {
        return [
            'loopback 127.0.0.1' => ['127.0.0.1'],
            'loopback 127.0.0.255' => ['127.0.0.255'],
            'private 10.0.0.0' => ['10.0.0.0'],
            'private 10.255.255.255' => ['10.255.255.255'],
            'private 172.16.0.0' => ['172.16.0.0'],
            'private 172.31.255.255' => ['172.31.255.255'],
            'private 192.168.0.0' => ['192.168.0.0'],
            'private 192.168.255.255' => ['192.168.255.255'],
            'link-local 169.254.0.0' => ['169.254.0.0'],
            'aws metadata 169.254.169.254' => ['169.254.169.254'],
            'broadcast 255.255.255.255' => ['255.255.255.255'],
            'reserved 0.0.0.0' => ['0.0.0.0'],
        ];
    }

    #[DataProvider('safeIpv4Provider')]
    public function test_identifies_safe_ipv4_addresses(string $ip): void
    {
        $this->assertFalse(
            UrlSecurityValidator::isUnsafeIp($ip),
            "IP should be identified as safe: {$ip}"
        );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function safeIpv4Provider(): array
    {
        return [
            'google dns' => ['8.8.8.8'],
            'cloudflare dns' => ['1.1.1.1'],
            'public ip' => ['203.0.113.1'],
        ];
    }

    #[DataProvider('unsafeIpv6Provider')]
    public function test_identifies_unsafe_ipv6_addresses(string $ip): void
    {
        $this->assertTrue(
            UrlSecurityValidator::isUnsafeIp($ip),
            "IPv6 should be identified as unsafe: {$ip}"
        );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function unsafeIpv6Provider(): array
    {
        return [
            'loopback ::1' => ['::1'],
            'private fc00::' => ['fc00::'],
            'private fc00::1' => ['fc00::1'],
            'private fd00::' => ['fd00::'],
            'private fd00::1' => ['fd00::1'],
            'link-local fe80::' => ['fe80::'],
            'link-local fe80::1' => ['fe80::1'],
            'unspecified ::' => ['::'],
        ];
    }

    #[DataProvider('safeIpv6Provider')]
    public function test_identifies_safe_ipv6_addresses(string $ip): void
    {
        $this->assertFalse(
            UrlSecurityValidator::isUnsafeIp($ip),
            "IPv6 should be identified as safe: {$ip}"
        );
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function safeIpv6Provider(): array
    {
        return [
            'google dns ipv6' => ['2001:4860:4860::8888'],
            'cloudflare dns ipv6' => ['2606:4700:4700::1111'],
        ];
    }

    public function test_is_safe_method_returns_boolean(): void
    {
        $this->assertTrue(UrlSecurityValidator::isSafe('https://example.com/feed.xml'));
        $this->assertFalse(UrlSecurityValidator::isSafe('http://127.0.0.1/feed.xml'));
        $this->assertFalse(UrlSecurityValidator::isSafe('ftp://example.com/feed.xml'));
    }

    public function test_handles_invalid_ip_format(): void
    {
        // Invalid IP format should be considered unsafe
        $this->assertTrue(UrlSecurityValidator::isUnsafeIp('not-an-ip'));
        $this->assertTrue(UrlSecurityValidator::isUnsafeIp(''));
        $this->assertTrue(UrlSecurityValidator::isUnsafeIp('999.999.999.999'));
    }

    public function test_returns_curl_resolve_for_hostname_urls(): void
    {
        // Use google.com as it reliably resolves in most environments
        $result = UrlSecurityValidator::validate('https://google.com/feed.xml');

        $this->assertTrue($result['valid']);
        $this->assertArrayHasKey('curl_resolve', $result);
        $this->assertNotEmpty($result['curl_resolve'], 'curl_resolve should contain entries for resolvable hostnames');
        $this->assertIsArray($result['curl_resolve']);

        // Format should be "host:port:ip1,ip2,..." (may contain IPv4 and/or IPv6)
        $this->assertStringStartsWith(
            'google.com:443:',
            $result['curl_resolve'][0],
            'curl_resolve entry should start with host:port:'
        );

        // Verify at least one IP address is present after host:port:
        $ipsString = substr($result['curl_resolve'][0], strlen('google.com:443:'));
        $this->assertNotEmpty($ipsString, 'curl_resolve should contain at least one IP address');

        // Check that it contains a valid IPv4 or IPv6 address
        $ips = explode(',', $ipsString);
        $hasValidIp = false;
        foreach ($ips as $ip) {
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                $hasValidIp = true;
                break;
            }
        }
        $this->assertTrue($hasValidIp, 'curl_resolve should contain a valid IPv4 or IPv6 address');
    }

    public function test_returns_empty_curl_resolve_for_ip_urls(): void
    {
        $result = UrlSecurityValidator::validate('http://8.8.8.8/feed.xml');

        $this->assertTrue($result['valid']);
        $this->assertArrayHasKey('curl_resolve', $result);
        $this->assertEmpty($result['curl_resolve']);
    }

    public function test_curl_resolve_uses_correct_port(): void
    {
        // HTTP defaults to port 80
        $httpResult = UrlSecurityValidator::validate('http://google.com/feed.xml');
        $this->assertNotEmpty($httpResult['curl_resolve']);
        $this->assertStringContainsString(':80:', $httpResult['curl_resolve'][0]);

        // HTTPS defaults to port 443
        $httpsResult = UrlSecurityValidator::validate('https://google.com/feed.xml');
        $this->assertNotEmpty($httpsResult['curl_resolve']);
        $this->assertStringContainsString(':443:', $httpsResult['curl_resolve'][0]);

        // Custom port should be used
        $customPortResult = UrlSecurityValidator::validate('https://google.com:8443/feed.xml');
        $this->assertNotEmpty($customPortResult['curl_resolve']);
        $this->assertStringContainsString(':8443:', $customPortResult['curl_resolve'][0]);
    }
}

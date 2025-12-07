<?php

declare(strict_types=1);

namespace Tests\Unit\Rules;

use App\Rules\SafeFeedUrl;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class SafeFeedUrlTest extends TestCase
{
    private SafeFeedUrl $rule;

    protected function setUp(): void
    {
        parent::setUp();
        $this->rule = new SafeFeedUrl;
    }

    #[DataProvider('invalidUrlsProvider')]
    public function test_fails_on_invalid_urls(mixed $url): void
    {
        $failed = false;
        $errorMessage = null;

        $this->rule->validate(
            'feed_url',
            $url,
            function (string $message) use (&$failed, &$errorMessage) {
                $failed = true;
                $errorMessage = $message;
            }
        );

        $this->assertTrue($failed, 'Validation should fail for: '.var_export($url, true));
    }

    /**
     * @return array<string, array{0: mixed}>
     */
    public static function invalidUrlsProvider(): array
    {
        return [
            // Non-string values
            'integer' => [123],
            'array' => [['http://example.com']],
            'null' => [null],

            // Non-http schemes
            'ftp scheme' => ['ftp://example.com/feed.xml'],
            'file scheme' => ['file:///etc/passwd'],

            // Private IPs
            'localhost' => ['http://127.0.0.1/feed.xml'],
            'private 10.x' => ['http://10.0.0.1/feed.xml'],
            'private 192.168.x' => ['http://192.168.1.1/feed.xml'],
            'aws metadata' => ['http://169.254.169.254/latest/meta-data/'],

            // IPv6 private
            'ipv6 loopback' => ['http://[::1]/feed.xml'],
            'ipv6 private' => ['http://[fc00::1]/feed.xml'],
        ];
    }

    #[DataProvider('validUrlsProvider')]
    public function test_passes_on_valid_urls(string $url): void
    {
        $failed = false;

        $this->rule->validate(
            'feed_url',
            $url,
            function () use (&$failed) {
                $failed = true;
            }
        );

        $this->assertFalse($failed, "Validation should pass for: {$url}");
    }

    /**
     * @return array<string, array{0: string}>
     */
    public static function validUrlsProvider(): array
    {
        return [
            'http url' => ['http://example.com/feed.xml'],
            'https url' => ['https://example.com/feed.xml'],
            'public ip' => ['http://8.8.8.8/feed.xml'],
        ];
    }
}

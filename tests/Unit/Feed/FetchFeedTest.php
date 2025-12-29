<?php

declare(strict_types=1);

namespace Tests\Unit\Feed;

use App\Actions\Feed\FetchFeed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use Tests\TestCase;

class FetchFeedTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        parent::tearDown();
        Mockery::close();
    }

    public function test_returns_success_with_valid_feed(): void
    {
        $mockFeed = Mockery::mock();
        $mockFeed->shouldReceive('error')->andReturnFalse();

        \Feeds::shouldReceive('make')->once()->andReturn($mockFeed);

        $action = new FetchFeed;
        $result = $action->handle('https://example.com/feed.xml');

        $this->assertTrue($result['success']);
        $this->assertSame($mockFeed, $result['feed']);
    }

    public function test_returns_error_when_feed_has_error(): void
    {
        $mockFeed = Mockery::mock();
        $mockFeed->shouldReceive('error')->andReturn('Invalid XML');

        \Feeds::shouldReceive('make')->once()->andReturn($mockFeed);

        $action = new FetchFeed;
        $result = $action->handle('https://example.com/feed.xml');

        $this->assertFalse($result['success']);
        $this->assertSame('Invalid XML', $result['error']);
    }

    public function test_returns_error_when_feed_error_is_array(): void
    {
        $mockFeed = Mockery::mock();
        $mockFeed->shouldReceive('error')->andReturn(['Error 1', 'Error 2']);

        \Feeds::shouldReceive('make')->once()->andReturn($mockFeed);

        $action = new FetchFeed;
        $result = $action->handle('https://example.com/feed.xml');

        $this->assertFalse($result['success']);
        $this->assertSame('Error 1, Error 2', $result['error']);
    }

    public function test_trims_trailing_colon_from_error(): void
    {
        $mockFeed = Mockery::mock();
        $mockFeed->shouldReceive('error')->andReturn('cURL error 3: ');

        \Feeds::shouldReceive('make')->once()->andReturn($mockFeed);

        $action = new FetchFeed;
        $result = $action->handle('https://example.com/feed.xml');

        $this->assertFalse($result['success']);
        $this->assertSame('cURL error 3', $result['error']);
    }

    public function test_blocks_unsafe_urls(): void
    {
        $action = new FetchFeed;

        // Test localhost
        $result = $action->handle('http://localhost/feed.xml');
        $this->assertFalse($result['success']);

        // Test private IP
        $result = $action->handle('http://192.168.1.1/feed.xml');
        $this->assertFalse($result['success']);

        // Test 127.0.0.1
        $result = $action->handle('http://127.0.0.1/feed.xml');
        $this->assertFalse($result['success']);
    }

    public function test_blocks_private_ip_ranges(): void
    {
        $action = new FetchFeed;

        // 10.x.x.x range
        $result = $action->handle('http://10.0.0.1/feed.xml');
        $this->assertFalse($result['success']);

        // 172.16.x.x range
        $result = $action->handle('http://172.16.0.1/feed.xml');
        $this->assertFalse($result['success']);
    }
}

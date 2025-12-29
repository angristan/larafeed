<?php

declare(strict_types=1);

namespace Tests\Unit\Favicon;

use App\Actions\Favicon\GetFaviconURL;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

class GetFaviconURLTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        parent::tearDown();
        Mockery::close();
    }

    public function test_returns_favicon_url_when_found(): void
    {
        $mockFavicon = Mockery::mock();
        $mockFavicon->shouldReceive('getFaviconUrl')->andReturn('https://example.com/favicon.ico');

        $mockFetcher = Mockery::mock();
        $mockFetcher->shouldReceive('fetch')->andReturn($mockFavicon);

        Favicon::shouldReceive('withFallback')->with('unavatar')->andReturn($mockFetcher);

        Http::fake([
            'https://example.com/favicon.ico' => Http::response('icon_content', 200, [
                'Content-Length' => '1024',
            ]),
        ]);

        $action = new GetFaviconURL;
        $result = $action->handle('https://example.com/page');

        $this->assertSame('https://example.com/favicon.ico', $result);
    }

    public function test_returns_null_when_no_favicon_found(): void
    {
        $mockFetcher = Mockery::mock();
        $mockFetcher->shouldReceive('fetch')->andReturn(null);

        Favicon::shouldReceive('withFallback')->with('unavatar')->andReturn($mockFetcher);

        $action = new GetFaviconURL;
        $result = $action->handle('https://example.com/page');

        $this->assertNull($result);
    }

    public function test_returns_null_when_favicon_url_is_empty(): void
    {
        $mockFavicon = Mockery::mock();
        $mockFavicon->shouldReceive('getFaviconUrl')->andReturn(null);

        $mockFetcher = Mockery::mock();
        $mockFetcher->shouldReceive('fetch')->andReturn($mockFavicon);

        Favicon::shouldReceive('withFallback')->with('unavatar')->andReturn($mockFetcher);

        $action = new GetFaviconURL;
        $result = $action->handle('https://example.com/page');

        $this->assertNull($result);
    }

    public function test_returns_null_when_favicon_request_fails(): void
    {
        $mockFavicon = Mockery::mock();
        $mockFavicon->shouldReceive('getFaviconUrl')->andReturn('https://example.com/favicon.ico');

        $mockFetcher = Mockery::mock();
        $mockFetcher->shouldReceive('fetch')->andReturn($mockFavicon);

        Favicon::shouldReceive('withFallback')->with('unavatar')->andReturn($mockFetcher);

        Http::fake([
            'https://example.com/favicon.ico' => Http::response('', 404),
        ]);

        $action = new GetFaviconURL;
        $result = $action->handle('https://example.com/page');

        $this->assertNull($result);
    }

    public function test_returns_null_when_favicon_is_empty(): void
    {
        $mockFavicon = Mockery::mock();
        $mockFavicon->shouldReceive('getFaviconUrl')->andReturn('https://example.com/favicon.ico');

        $mockFetcher = Mockery::mock();
        $mockFetcher->shouldReceive('fetch')->andReturn($mockFavicon);

        Favicon::shouldReceive('withFallback')->with('unavatar')->andReturn($mockFetcher);

        Http::fake([
            'https://example.com/favicon.ico' => Http::response('', 200, [
                'Content-Length' => '0',
            ]),
        ]);

        $action = new GetFaviconURL;
        $result = $action->handle('https://example.com/page');

        $this->assertNull($result);
    }

    public function test_returns_null_on_exception(): void
    {
        Favicon::shouldReceive('withFallback')
            ->with('unavatar')
            ->andThrow(new \Exception('Network error'));

        $action = new GetFaviconURL;
        $result = $action->handle('https://example.com/page');

        $this->assertNull($result);
    }

    public function test_extracts_base_url_from_path(): void
    {
        $mockFavicon = Mockery::mock();
        $mockFavicon->shouldReceive('getFaviconUrl')->andReturn('https://blog.example.com/favicon.ico');

        $mockFetcher = Mockery::mock();
        $mockFetcher->shouldReceive('fetch')
            ->with('https://blog.example.com')
            ->andReturn($mockFavicon);

        Favicon::shouldReceive('withFallback')->with('unavatar')->andReturn($mockFetcher);

        Http::fake([
            'https://blog.example.com/favicon.ico' => Http::response('icon_content', 200, [
                'Content-Length' => '1024',
            ]),
        ]);

        $action = new GetFaviconURL;
        $result = $action->handle('https://blog.example.com/feed.xml');

        $this->assertSame('https://blog.example.com/favicon.ico', $result);
    }
}

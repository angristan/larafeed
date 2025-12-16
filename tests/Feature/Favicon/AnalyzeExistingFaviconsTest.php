<?php

declare(strict_types=1);

namespace Tests\Feature\Favicon;

use App\Actions\Favicon\AnalyzeFaviconBrightness;
use App\Models\Feed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Mockery;
use Tests\TestCase;

class AnalyzeExistingFaviconsTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        parent::tearDown();
        Mockery::close();
    }

    private function mockSsrfValidation(): void
    {
        $mock = Mockery::mock(AnalyzeFaviconBrightness::class)
            ->makePartial()
            ->shouldAllowMockingProtectedMethods();
        $mock->shouldReceive('isUrlSafe')->andReturn(true);

        $this->app->instance(AnalyzeFaviconBrightness::class, $mock);
    }

    public function test_command_analyzes_feeds_with_favicons(): void
    {
        $this->mockSsrfValidation();

        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createDarkPng(),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $feedWithFavicon = Feed::factory()->create([
            'favicon_url' => 'https://example.com/favicon.png',
            'favicon_is_dark' => null,
        ]);

        $feedWithoutFavicon = Feed::factory()->create([
            'favicon_url' => null,
            'favicon_is_dark' => null,
        ]);

        $this->artisan('feeds:analyze-favicon-brightness')
            ->assertSuccessful();

        $feedWithFavicon->refresh();
        $feedWithoutFavicon->refresh();

        $this->assertTrue($feedWithFavicon->favicon_is_dark);
        $this->assertNull($feedWithoutFavicon->favicon_is_dark);
    }

    public function test_command_skips_already_analyzed_feeds(): void
    {
        Http::fake();

        Feed::factory()->create([
            'favicon_url' => 'https://example.com/favicon.png',
            'favicon_is_dark' => false,
        ]);

        $this->artisan('feeds:analyze-favicon-brightness')
            ->expectsOutput('No favicons to analyze.')
            ->assertSuccessful();

        Http::assertNothingSent();
    }

    public function test_command_reanalyzes_with_force_flag(): void
    {
        $this->mockSsrfValidation();

        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createDarkPng(),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $feed = Feed::factory()->create([
            'favicon_url' => 'https://example.com/favicon.png',
            'favicon_is_dark' => false,
        ]);

        $this->artisan('feeds:analyze-favicon-brightness', ['--force' => true])
            ->assertSuccessful();

        $feed->refresh();
        $this->assertTrue($feed->favicon_is_dark);
    }

    public function test_command_handles_failed_analysis(): void
    {
        $this->mockSsrfValidation();

        Http::fake([
            'localhost:8080/*' => Http::response('Not Found', 404),
        ]);

        $feed = Feed::factory()->create([
            'favicon_url' => 'https://example.com/favicon.png',
            'favicon_is_dark' => null,
        ]);

        $this->artisan('feeds:analyze-favicon-brightness')
            ->assertSuccessful();

        $feed->refresh();
        // Failed analysis should default to true (dark) to avoid retries
        $this->assertTrue($feed->favicon_is_dark);
    }

    public function test_command_outputs_no_favicons_message_when_empty(): void
    {
        Feed::factory()->create([
            'favicon_url' => null,
            'favicon_is_dark' => null,
        ]);

        $this->artisan('feeds:analyze-favicon-brightness')
            ->expectsOutput('No favicons to analyze.')
            ->assertSuccessful();
    }

    public function test_command_detects_light_favicon(): void
    {
        $this->mockSsrfValidation();

        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createLightPng(),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $feed = Feed::factory()->create([
            'favicon_url' => 'https://example.com/favicon.png',
            'favicon_is_dark' => null,
        ]);

        $this->artisan('feeds:analyze-favicon-brightness')
            ->assertSuccessful();

        $feed->refresh();
        $this->assertFalse($feed->favicon_is_dark);
    }

    private function createDarkPng(): string
    {
        $image = imagecreatetruecolor(10, 10);
        $color = imagecolorallocate($image, 0, 0, 0);
        imagefill($image, 0, 0, $color);

        ob_start();
        imagepng($image);

        return ob_get_clean();
    }

    private function createLightPng(): string
    {
        $image = imagecreatetruecolor(10, 10);
        $color = imagecolorallocate($image, 255, 255, 255);
        imagefill($image, 0, 0, $color);

        ob_start();
        imagepng($image);

        return ob_get_clean();
    }
}

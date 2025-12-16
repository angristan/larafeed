<?php

declare(strict_types=1);

namespace Tests\Unit\Favicon;

use App\Actions\Favicon\AnalyzeFaviconBrightness;
use Illuminate\Foundation\Testing\TestCase;
use Illuminate\Support\Facades\Http;

class AnalyzeFaviconBrightnessTest extends TestCase
{
    private AnalyzeFaviconBrightness $action;

    protected function setUp(): void
    {
        parent::setUp();
        $this->action = new AnalyzeFaviconBrightness;
    }

    public function createApplication()
    {
        $app = require __DIR__.'/../../../bootstrap/app.php';
        $app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

        return $app;
    }

    public function test_detects_dark_favicon(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(0, 0, 0),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertTrue($result);
    }

    public function test_detects_light_favicon(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(255, 255, 255),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertFalse($result);
    }

    public function test_detects_dark_gray_favicon(): void
    {
        // Brightness of RGB(50,50,50) = 50, which is below threshold of 80
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(50, 50, 50),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertTrue($result);
    }

    public function test_detects_light_gray_favicon(): void
    {
        // Brightness of RGB(150,150,150) = 150, which is above threshold of 80
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(150, 150, 150),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertFalse($result);
    }

    public function test_returns_null_on_http_failure(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response('Not Found', 404),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertNull($result);
    }

    public function test_returns_null_on_invalid_image_data(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                'not an image',
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertNull($result);
    }

    public function test_returns_null_for_fully_transparent_image(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createTransparentPng(),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertNull($result);
    }

    public function test_handles_colored_favicon_brightness(): void
    {
        // Red: brightness = 0.299*255 + 0.587*0 + 0.114*0 = 76.2 (dark)
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(255, 0, 0),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertTrue($result);
    }

    public function test_handles_green_favicon_as_light(): void
    {
        // Green: brightness = 0.299*0 + 0.587*255 + 0.114*0 = 149.7 (light)
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(0, 255, 0),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertFalse($result);
    }

    public function test_handles_1x1_pixel_image(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createPng(0, 0, 0, 1, 1),
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/tiny-favicon.png');

        $this->assertTrue($result);
    }

    public function test_handles_semi_transparent_dark_image(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createSemiTransparentPng(0, 0, 0, 64), // 50% opacity black
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertTrue($result);
    }

    public function test_handles_semi_transparent_light_image(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(
                $this->createSemiTransparentPng(255, 255, 255, 64), // 50% opacity white
                200,
                ['Content-Type' => 'image/png']
            ),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertFalse($result);
    }

    public function test_returns_null_for_internal_url_ssrf_protection(): void
    {
        // Should not even make HTTP request for internal URLs
        Http::fake();

        $result = $this->action->handle('http://169.254.169.254/latest/meta-data/');

        $this->assertNull($result);
        Http::assertNothingSent();
    }

    public function test_returns_null_for_localhost_ssrf_protection(): void
    {
        Http::fake();

        $result = $this->action->handle('http://127.0.0.1/favicon.png');

        $this->assertNull($result);
        Http::assertNothingSent();
    }

    public function test_returns_null_for_private_ip_ssrf_protection(): void
    {
        Http::fake();

        $result = $this->action->handle('http://192.168.1.1/favicon.png');

        $this->assertNull($result);
        Http::assertNothingSent();
    }

    public function test_returns_null_on_connection_exception(): void
    {
        Http::fake([
            'localhost:8080/*' => Http::response(null, 500),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertNull($result);
    }

    /**
     * Create a fully transparent PNG image.
     */
    private function createTransparentPng(): string
    {
        $image = imagecreatetruecolor(10, 10);
        imagesavealpha($image, true);
        $transparent = imagecolorallocatealpha($image, 0, 0, 0, 127);
        imagefill($image, 0, 0, $transparent);

        ob_start();
        imagepng($image);

        return ob_get_clean();
    }

    /**
     * Create a solid color PNG image with configurable size.
     */
    private function createPng(int $r, int $g, int $b, int $width = 10, int $height = 10): string
    {
        $image = imagecreatetruecolor($width, $height);
        $color = imagecolorallocate($image, $r, $g, $b);
        imagefill($image, 0, 0, $color);

        ob_start();
        imagepng($image);

        return ob_get_clean();
    }

    /**
     * Create a semi-transparent PNG image.
     */
    private function createSemiTransparentPng(int $r, int $g, int $b, int $alpha): string
    {
        $image = imagecreatetruecolor(10, 10);
        imagesavealpha($image, true);
        $color = imagecolorallocatealpha($image, $r, $g, $b, $alpha);
        imagefill($image, 0, 0, $color);

        ob_start();
        imagepng($image);

        return ob_get_clean();
    }
}

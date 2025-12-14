<?php

declare(strict_types=1);

namespace Tests\Unit\Favicon;

use App\Actions\Favicon\AnalyzeFaviconBrightness;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AnalyzeFaviconBrightnessTest extends TestCase
{
    private AnalyzeFaviconBrightness $action;

    protected function setUp(): void
    {
        parent::setUp();
        $this->action = new AnalyzeFaviconBrightness;
    }

    public function test_detects_dark_svg_with_dark_hex_color(): void
    {
        $darkSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#1a1a1a" d="M0 0h10v10H0z"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($darkSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertTrue($result);
    }

    public function test_detects_light_svg_with_light_hex_color(): void
    {
        $lightSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#ffffff" d="M0 0h10v10H0z"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($lightSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertFalse($result);
    }

    public function test_detects_dark_svg_with_black_named_color(): void
    {
        $darkSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="black" width="10" height="10"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($darkSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertTrue($result);
    }

    public function test_detects_light_svg_with_white_named_color(): void
    {
        $lightSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="white" width="10" height="10"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($lightSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertFalse($result);
    }

    public function test_svg_path_without_fill_defaults_to_black(): void
    {
        // SVG paths without explicit fill default to black
        $svgWithPath = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10H0z"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($svgWithPath, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertTrue($result);
    }

    public function test_detects_svg_by_file_extension(): void
    {
        $darkSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000000" d="M0 0h10v10H0z"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($darkSvg, 200, ['Content-Type' => 'text/plain']),
        ]);

        // Should detect as SVG by .svg extension even with wrong content-type
        $result = $this->action->handle('https://example.com/icon.svg');

        $this->assertTrue($result);
    }

    public function test_detects_dark_svg_with_short_hex_color(): void
    {
        $darkSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h10v10H0z"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($darkSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertTrue($result);
    }

    public function test_detects_light_svg_with_short_hex_color(): void
    {
        $lightSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#fff" d="M0 0h10v10H0z"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($lightSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertFalse($result);
    }

    public function test_returns_null_on_http_failure(): void
    {
        Http::fake([
            'example.com/*' => Http::response('Not Found', 404),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertNull($result);
    }

    public function test_detects_dark_png_image(): void
    {
        // Create a 2x2 black PNG
        $image = imagecreatetruecolor(2, 2);
        $black = imagecolorallocate($image, 0, 0, 0);
        imagefill($image, 0, 0, $black);

        ob_start();
        imagepng($image);
        $pngData = ob_get_clean();
        imagedestroy($image);

        Http::fake([
            'example.com/*' => Http::response($pngData, 200, ['Content-Type' => 'image/png']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertTrue($result);
    }

    public function test_detects_light_png_image(): void
    {
        // Create a 2x2 white PNG
        $image = imagecreatetruecolor(2, 2);
        $white = imagecolorallocate($image, 255, 255, 255);
        imagefill($image, 0, 0, $white);

        ob_start();
        imagepng($image);
        $pngData = ob_get_clean();
        imagedestroy($image);

        Http::fake([
            'example.com/*' => Http::response($pngData, 200, ['Content-Type' => 'image/png']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.png');

        $this->assertFalse($result);
    }

    public function test_detects_svg_with_rgb_color(): void
    {
        $darkSvg = '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill: rgb(10, 10, 10)" width="10" height="10"/></svg>';

        Http::fake([
            'example.com/*' => Http::response($darkSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://example.com/favicon.svg');

        $this->assertTrue($result);
    }

    public function test_github_style_dark_svg(): void
    {
        // Similar to GitHub's actual favicon structure
        $githubSvg = '<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M16 0C7.16 0 0 7.16 0 16..." fill="#24292E"/>
        </svg>';

        Http::fake([
            'github.com/*' => Http::response($githubSvg, 200, ['Content-Type' => 'image/svg+xml']),
        ]);

        $result = $this->action->handle('https://github.com/favicon.svg');

        $this->assertTrue($result);
    }
}

<?php

declare(strict_types=1);

namespace App\Actions\Favicon;

use App\Support\UrlSecurityValidator;
use GdImage;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use Onliner\ImgProxy\Options\Resize;
use Onliner\ImgProxy\Options\ResizingType;
use Onliner\ImgProxy\UrlBuilder;

class AnalyzeFaviconBrightness
{
    use AsAction;

    private const SAMPLE_SIZE = 10;

    private const BRIGHTNESS_THRESHOLD = 80;

    /**
     * Analyze if a favicon is predominantly dark.
     *
     * Uses imgproxy to fetch and resize the favicon to a 10x10 PNG,
     * then calculates the average brightness of the pixels.
     *
     * @param  string  $favicon_url  The URL of the favicon to analyze
     * @return bool|null True if dark, false if light, null if analysis failed
     */
    public function handle(string $favicon_url): ?bool
    {
        try {
            // Validate URL to prevent SSRF attacks
            if (! UrlSecurityValidator::isSafe($favicon_url)) {
                Log::warning('Favicon URL failed SSRF validation', [
                    'favicon_url' => $favicon_url,
                ]);

                return null;
            }

            $proxiedUrl = $this->buildProxiedUrl($favicon_url);

            /** @var \Illuminate\Http\Client\Response $response */
            $response = Http::timeout(10)->get($proxiedUrl);

            if (! $response->ok()) {
                Log::warning('Failed to fetch favicon via imgproxy for brightness analysis', [
                    'favicon_url' => $favicon_url,
                    'proxied_url' => $proxiedUrl,
                    'status' => $response->status(),
                ]);

                return null;
            }

            $image = @imagecreatefromstring($response->body());

            if (! $image instanceof GdImage) {
                Log::warning('Failed to create GD image from proxied favicon', [
                    'favicon_url' => $favicon_url,
                ]);

                return null;
            }

            $brightness = $this->calculateAverageBrightness($image);

            if ($brightness === null) {
                Log::warning('Failed to analyze favicon brightness (fully transparent)', [
                    'favicon_url' => $favicon_url,
                ]);

                return null;
            }

            $isDark = $brightness < self::BRIGHTNESS_THRESHOLD;

            Log::debug('Favicon brightness analysis', [
                'favicon_url' => $favicon_url,
                'brightness' => $brightness,
                'is_dark' => $isDark,
            ]);

            return $isDark;

        } catch (\Throwable $e) {
            Log::error('Exception during favicon brightness analysis', [
                'favicon_url' => $favicon_url,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Build a proxied URL that resizes the favicon to a small PNG for analysis.
     */
    private function buildProxiedUrl(string $favicon_url): string
    {
        $uri = app(UrlBuilder::class)
            ->with(new Resize(ResizingType::FORCE, self::SAMPLE_SIZE, self::SAMPLE_SIZE))
            ->url($favicon_url, 'png');

        return config('services.imgproxy.url').$uri;
    }

    /**
     * Calculate the average brightness of the image, considering only non-transparent pixels.
     */
    private function calculateAverageBrightness(GdImage $image): ?float
    {
        $width = imagesx($image);
        $height = imagesy($image);

        $totalBrightness = 0.0;
        $pixelCount = 0.0;

        for ($x = 0; $x < $width; $x++) {
            for ($y = 0; $y < $height; $y++) {
                $rgba = imagecolorat($image, $x, $y);

                $alpha = ($rgba >> 24) & 0x7F; // 0 = opaque, 127 = transparent

                if ($alpha === 127) {
                    continue;
                }

                $r = ($rgba >> 16) & 0xFF;
                $g = ($rgba >> 8) & 0xFF;
                $b = $rgba & 0xFF;

                // Perceived brightness using luminance formula
                $brightness = 0.299 * $r + 0.587 * $g + 0.114 * $b;

                // Weight by opacity
                $opacity = 1 - ($alpha / 127);
                $totalBrightness += $brightness * $opacity;
                $pixelCount += $opacity;
            }
        }

        if ($pixelCount < 0.001) {
            return null;
        }

        return $totalBrightness / $pixelCount;
    }
}

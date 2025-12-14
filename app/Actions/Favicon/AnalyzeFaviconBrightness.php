<?php

declare(strict_types=1);

namespace App\Actions\Favicon;

use GdImage;
use Http;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class AnalyzeFaviconBrightness
{
    use AsAction;

    /**
     * Analyze if a favicon is predominantly dark.
     *
     * @param  string  $favicon_url  The URL of the favicon to analyze
     * @return bool|null True if dark, false if light, null if analysis failed
     */
    public function handle(string $favicon_url): ?bool
    {
        try {
            /** @var \Illuminate\Http\Client\Response $response */
            $response = Http::timeout(10)->get($favicon_url);

            if (! $response->ok()) {
                Log::warning('Failed to fetch favicon for brightness analysis', [
                    'favicon_url' => $favicon_url,
                    'status' => $response->status(),
                ]);

                return null;
            }

            $imageData = $response->body();
            $contentType = $response->header('Content-Type');

            // Check if it's an SVG
            $isSvg = str_contains($contentType, 'svg') ||
                     str_ends_with(strtolower($favicon_url), '.svg') ||
                     str_starts_with(trim($imageData), '<svg') ||
                     str_starts_with(trim($imageData), '<?xml');

            if ($isSvg) {
                $brightness = $this->analyzeSvgBrightness($imageData);
            } else {
                $brightness = $this->analyzeRasterBrightness($imageData);
            }

            if ($brightness === null) {
                Log::warning('Failed to analyze favicon brightness', [
                    'favicon_url' => $favicon_url,
                    'is_svg' => $isSvg,
                ]);

                return null;
            }

            // Threshold: if average brightness is below 80 (out of 255), consider it dark
            // This accounts for icons that are mostly dark with some lighter elements
            $isDark = $brightness < 80;

            Log::debug('Favicon brightness analysis', [
                'favicon_url' => $favicon_url,
                'brightness' => $brightness,
                'is_dark' => $isDark,
                'is_svg' => $isSvg,
            ]);

            return $isDark;

        } catch (\Exception $e) {
            Log::error('Exception during favicon brightness analysis', [
                'favicon_url' => $favicon_url,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    /**
     * Analyze brightness of an SVG by parsing its colors.
     */
    private function analyzeSvgBrightness(string $svgContent): ?float
    {
        // Extract all color values from the SVG
        $colors = [];

        // Match hex colors (#rgb, #rrggbb)
        if (preg_match_all('/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/', $svgContent, $matches)) {
            foreach ($matches[1] as $hex) {
                $rgb = $this->hexToRgb($hex);
                if ($rgb !== null) {
                    $colors[] = $rgb;
                }
            }
        }

        // Match rgb/rgba colors
        if (preg_match_all('/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/', $svgContent, $matches, PREG_SET_ORDER)) {
            foreach ($matches as $match) {
                $colors[] = [(int) $match[1], (int) $match[2], (int) $match[3]];
            }
        }

        // Match named colors (common dark ones)
        $namedColors = [
            'black' => [0, 0, 0],
            'white' => [255, 255, 255],
            'red' => [255, 0, 0],
            'green' => [0, 128, 0],
            'blue' => [0, 0, 255],
            'yellow' => [255, 255, 0],
            'orange' => [255, 165, 0],
            'gray' => [128, 128, 128],
            'grey' => [128, 128, 128],
            'navy' => [0, 0, 128],
            'darkblue' => [0, 0, 139],
            'darkgray' => [169, 169, 169],
            'darkgrey' => [169, 169, 169],
            'dimgray' => [105, 105, 105],
            'dimgrey' => [105, 105, 105],
        ];

        foreach ($namedColors as $name => $rgb) {
            // Match fill="colorname" or stroke="colorname" or color:colorname
            if (preg_match('/(?:fill|stroke|color)\s*[=:]\s*["\']?'.$name.'\b/i', $svgContent)) {
                $colors[] = $rgb;
            }
        }

        // Check for currentColor with a color style (often used for dark icons)
        if (str_contains(strtolower($svgContent), 'currentcolor')) {
            // If using currentColor, assume it inherits from context (often dark)
            // Look for any explicit color definitions
            if (preg_match('/color\s*:\s*#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/', $svgContent, $match)) {
                $rgb = $this->hexToRgb($match[1]);
                if ($rgb !== null) {
                    $colors[] = $rgb;
                }
            }
        }

        if (empty($colors)) {
            // No colors found - check if it's a simple path-based SVG (often black by default)
            if (preg_match('/<path\b[^>]*>/i', $svgContent) && ! preg_match('/fill\s*=\s*["\']?none/i', $svgContent)) {
                // SVG paths default to black fill if not specified
                $colors[] = [0, 0, 0];
            } else {
                return null;
            }
        }

        // Calculate average brightness from found colors
        $totalBrightness = 0.0;
        foreach ($colors as $rgb) {
            $totalBrightness += 0.299 * $rgb[0] + 0.587 * $rgb[1] + 0.114 * $rgb[2];
        }

        return $totalBrightness / count($colors);
    }

    /**
     * Convert hex color to RGB array.
     *
     * @return array{0: int, 1: int, 2: int}|null
     */
    private function hexToRgb(string $hex): ?array
    {
        $hex = ltrim($hex, '#');

        if (strlen($hex) === 3) {
            $hex = $hex[0].$hex[0].$hex[1].$hex[1].$hex[2].$hex[2];
        }

        if (strlen($hex) !== 6) {
            return null;
        }

        return [
            (int) hexdec(substr($hex, 0, 2)),
            (int) hexdec(substr($hex, 2, 2)),
            (int) hexdec(substr($hex, 4, 2)),
        ];
    }

    /**
     * Analyze brightness of a raster image (PNG, JPEG, GIF, etc.).
     */
    private function analyzeRasterBrightness(string $imageData): ?float
    {
        $image = @imagecreatefromstring($imageData);

        if (! $image instanceof GdImage) {
            return null;
        }

        $brightness = $this->calculateAverageBrightness($image);
        imagedestroy($image);

        return $brightness;
    }

    /**
     * Calculate the average brightness of an image, considering only non-transparent pixels.
     */
    private function calculateAverageBrightness(GdImage $image): ?float
    {
        $width = imagesx($image);
        $height = imagesy($image);

        // Sample pixels (for performance, sample at most 100 pixels)
        $sampleSize = min($width * $height, 100);
        $stepX = max(1, (int) floor($width / sqrt($sampleSize)));
        $stepY = max(1, (int) floor($height / sqrt($sampleSize)));

        $totalBrightness = 0.0;
        $pixelCount = 0.0;

        for ($x = 0; $x < $width; $x += $stepX) {
            for ($y = 0; $y < $height; $y += $stepY) {
                $rgba = imagecolorat($image, $x, $y);

                // Extract RGBA values
                $alpha = ($rgba >> 24) & 0x7F; // 0 = opaque, 127 = transparent

                // Skip fully transparent pixels
                if ($alpha === 127) {
                    continue;
                }

                $r = ($rgba >> 16) & 0xFF;
                $g = ($rgba >> 8) & 0xFF;
                $b = $rgba & 0xFF;

                // Calculate perceived brightness using luminance formula
                // This weights green more heavily as human eyes are more sensitive to it
                $brightness = 0.299 * $r + 0.587 * $g + 0.114 * $b;

                // Weight by opacity (semi-transparent pixels count less)
                $opacity = 1 - ($alpha / 127);
                $totalBrightness += $brightness * $opacity;
                $pixelCount += $opacity;
            }
        }

        if ($pixelCount < 0.001) {
            // Image is fully transparent
            return null;
        }

        return $totalBrightness / $pixelCount;
    }
}

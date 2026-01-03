<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use DOMDocument;
use DOMXPath;
use Lorisleiva\Actions\Concerns\AsAction;
use Onliner\ImgProxy\Options\Dpr;
use Onliner\ImgProxy\UrlBuilder;

class ProxifyImagesInHTML
{
    use AsAction;

    // Proxies all images in the HTML content using ImgProxy
    public function handle(string $content): string
    {
        $doc = new DOMDocument('1.0', 'UTF-8');

        // Prevent XML parsing errors from showing
        libxml_use_internal_errors(true);

        // Convert input to UTF-8 properly
        $detectedEncoding = mb_detect_encoding($content);
        $content = mb_convert_encoding($content, 'UTF-8', $detectedEncoding ?: 'UTF-8');

        // Add HTML wrapper with proper charset
        $content = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>'.$content.'</body></html>';

        // Load with proper encoding flags
        $doc->loadHTML($content, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOERROR);
        libxml_clear_errors();

        $xpath = new DOMXPath($doc);

        $images = $xpath->query('//img');
        if ($images !== false) {
            foreach ($images as $img) {
                if (! ($img instanceof \DOMElement)) {
                    continue;
                }

                // Handle src attribute
                $originalUrl = $img->getAttribute('src');
                if ($originalUrl) {
                    $proxiedUrl = $this->getProxiedUrl($originalUrl);
                    $img->setAttribute('src', $proxiedUrl);
                }

                // Handle srcset attribute
                $srcset = $img->getAttribute('srcset');
                if ($srcset) {
                    $proxiedSrcset = $this->proxifySrcset($srcset);
                    $img->setAttribute('srcset', $proxiedSrcset);
                }
            }
        }

        $pictures = $xpath->query('//picture');
        if ($pictures !== false) {
            foreach ($pictures as $picture) {
                if (! ($picture instanceof \DOMElement)) {
                    continue;
                }

                $sources = $xpath->query('.//source', $picture);
                if ($sources !== false) {
                    foreach ($sources as $source) {
                        if (! ($source instanceof \DOMElement)) {
                            continue;
                        }

                        // Handle srcset attribute
                        $srcset = $source->getAttribute('srcset');
                        if ($srcset) {
                            $proxiedSrcset = $this->proxifySrcset($srcset);
                            $source->setAttribute('srcset', $proxiedSrcset);
                        }
                    }
                }
            }
        }

        // Extract only the body content
        $html = $doc->saveHTML($doc->getElementsByTagName('body')->item(0));
        if ($html === false) {
            return '';
        }
        // Remove body tags
        $html = preg_replace('/<\/?body>/', '', $html) ?? '';

        return trim($html);
    }

    private function proxifySrcset(string $srcset): string
    {
        $parts = explode(',', $srcset);
        $parts = array_map($this->proxifySrcsetPart(...), $parts);

        return implode(', ', $parts);
    }

    private function proxifySrcsetPart(string $srcsetPart): string
    {
        $trimmed = trim($srcsetPart);
        [$url, $descriptor] = preg_split('/\s+/', $trimmed, 2) + [1 => ''];

        return $this->getProxiedUrl($url).($descriptor ? " {$descriptor}" : '');
    }

    private function getProxiedUrl(string $originalUrl): string
    {
        $proxiedUri = app(UrlBuilder::class)
            // Add a no-op option so the generated path keeps a dedicated segment and proxies don't collapse the double slash
            ->with(new Dpr(1))
            ->url($originalUrl, 'webp');

        return config('services.imgproxy.url').$proxiedUri;
    }
}

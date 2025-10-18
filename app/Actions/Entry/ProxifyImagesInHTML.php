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
        $content = mb_convert_encoding($content, 'UTF-8', mb_detect_encoding($content));

        // Add HTML wrapper with proper charset
        $content = '<!DOCTYPE html><html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body>'.$content.'</body></html>';

        // Load with proper encoding flags
        $doc->loadHTML($content, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOERROR);
        libxml_clear_errors();

        $xpath = new DOMXPath($doc);

        foreach ($xpath->query('//img') as $img) {
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

        foreach ($xpath->query('//picture') as $picture) {
            foreach ($xpath->query('.//source', $picture) as $source) {
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

        // Extract only the body content
        $html = $doc->saveHTML($doc->getElementsByTagName('body')->item(0));
        // Remove body tags
        $html = preg_replace('/<\/?body>/', '', $html);

        return trim($html);
    }

    private function proxifySrcset(string $srcset): string
    {
        return implode(', ', array_map(function ($srcsetPart) {
            [$url, $descriptor] = preg_split('/\s+/', trim($srcsetPart), 2) + [1 => ''];
            $proxiedUrl = $this->getProxiedUrl($url);

            return $proxiedUrl.($descriptor ? ' '.$descriptor : '');
        }, explode(',', $srcset)));
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

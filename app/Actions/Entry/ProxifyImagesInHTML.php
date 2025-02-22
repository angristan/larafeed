<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use DOMDocument;
use DOMXPath;
use Lorisleiva\Actions\Concerns\AsAction;
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

        // Convert HTML entities and load with proper encoding
        $content = htmlspecialchars_decode($content, ENT_QUOTES | ENT_HTML5);
        $doc->loadHTML($content, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NOERROR);
        libxml_clear_errors();

        $xpath = new DOMXPath($doc);
        $images = $xpath->query('//img');

        foreach ($images as $img) {
            if (! ($img instanceof \DOMElement)) {
                continue;
            }

            $originalUrl = $img->getAttribute('src');
            if (! $originalUrl) {
                continue;
            }

            $proxiedUri = app(UrlBuilder::class)
                ->url($originalUrl, 'webp');

            $proxiedUrl = config('services.imgproxy.url').$proxiedUri;

            $img->setAttribute('src', $proxiedUrl);
        }

        return $doc->saveHTML();
    }
}

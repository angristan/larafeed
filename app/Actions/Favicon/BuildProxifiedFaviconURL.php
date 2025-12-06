<?php

declare(strict_types=1);

namespace App\Actions\Favicon;

use Lorisleiva\Actions\Concerns\AsAction;
use Onliner\ImgProxy\Options\Dpr;
use Onliner\ImgProxy\Options\Height;
use Onliner\ImgProxy\Options\Width;
use Onliner\ImgProxy\UrlBuilder;

class BuildProxifiedFaviconURL
{
    use AsAction;

    public function handle(?string $favicon_url): string
    {
        if (is_null($favicon_url)) {
            return config('app.url').'/rss.svg';
        }

        $favicon_uri = app(UrlBuilder::class)
            ->with(
                new Width(32),
                new Height(32),
                new Dpr(2),
            )
            ->url($favicon_url, 'webp');

        $favicon_url = config('services.imgproxy.url').$favicon_uri;

        return $favicon_url;
    }
}

<?php

namespace App\Actions;

use Lorisleiva\Actions\Concerns\AsAction;
use Onliner\ImgProxy\Options\Dpr;
use Onliner\ImgProxy\Options\Height;
use Onliner\ImgProxy\Options\Width;
use Onliner\ImgProxy\UrlBuilder;

class BuildProfixedFaviconURL
{
    use AsAction;

    public function handle(?string $favicon_url)
    {
        if (is_null($favicon_url)) {
            return null;
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

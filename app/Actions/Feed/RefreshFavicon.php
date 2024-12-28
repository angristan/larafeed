<?php

namespace App\Actions\Feed;

use App\Models\Feed;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshFavicon
{
    use AsAction;

    public function handle(Feed $feed): void
    {
        $favicon_url = Favicon::withFallback('unavatar')
            ->fetch($feed->site_url)
            ?->getFaviconUrl();

        if ($favicon_url) {
            $feed->favicon_url = $favicon_url;
            $feed->save();

            Log::info('Favicon refreshed for feed: '.$feed->site_url);
        } else {
            Log::warning('Failed to refresh favicon for feed: '.$feed->site_url);
        }
    }
}
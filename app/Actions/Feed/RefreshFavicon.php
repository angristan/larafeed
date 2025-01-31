<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Favicon\GetFaviconURL;
use App\Models\Feed;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshFavicon
{
    use AsAction;

    public function handle(Feed $feed): void
    {
        $favicon_url = GetFaviconURL::run($feed->site_url);

        if ($favicon_url) {
            $feed->favicon_url = $favicon_url;
            $feed->save();

            Log::info('Favicon refreshed for feed: '.$feed->site_url);
        } else {
            Log::warning('Failed to refresh favicon for feed: '.$feed->site_url);
        }
    }
}

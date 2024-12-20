<?php

namespace App\Actions\Feed;

use App\Models\Feed;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class CreateNewFeed
{
    use AsAction;

    public function handle(string $feed_url)
    {
        // Skip if feed already exists
        if (Feed::where('feed_url', $feed_url)->exists()) {
            return;
        }

        // TODO fetch limit
        $crawledFeed = \Feeds::make(feedUrl: $feed_url);
        if ($crawledFeed->error()) {
            $error = '';
            if (is_array($crawledFeed->error())) {
                $error = implode(', ', $crawledFeed->error());
            } else {
                $error = $crawledFeed->error();
            }
            // "cURL error 3: " -> "cURL error 3"
            // idk why it adds a colon at the end
            $error = rtrim($error, ': ');

            Log::error($error);
            // return redirect()->back()->withErrors([
            //     'feed_url' => $error,
            // ]);

            return;
        }

        // Handle feeds without site link such as https://aggregate.stitcher.io/rss
        $site_url = $crawledFeed->get_link() ?? $feed_url;

        // TODO fix + cache/store + refresh
        try {
            $favicon_url = Favicon::withFallback('favicon-kit')->fetch($site_url)?->getFaviconUrl();
        } catch (\Exception $e) {
            Log::error('Failed to fetch favicon for '.$site_url.': '.$e->getMessage());
            $favicon_url = null;
        }

        $feed = Feed::create([
            'name' => $crawledFeed->get_title() ?? $site_url,
            'feed_url' => $feed_url,
            'site_url' => $site_url,
            'favicon_url' => $favicon_url,
        ]);

        // TODO single insert
        $entries = $crawledFeed->get_items();
        foreach ($entries as $entry) {
            $feed->entries()->create([
                'title' => $entry->get_title(),
                'url' => $entry->get_permalink(),
                'content' => $entry->get_content(),
                'published_at' => $entry->get_date('Y-m-d H:i:s'),
            ]);
        }

    }
}

<?php

namespace App\Actions\Feed;

use App\Exceptions\FeedCrawlFailedException;
use App\Models\Feed;
use Feeds;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use SimplePie\Item;

class RefreshFeedEntries
{
    use AsAction;

    public function asJob(Feed $feed)
    {
        RefreshFeedEntries::run($feed);
    }

    public function handle(Feed $feed)
    {
        $crawledFeed = Feeds::make(feedUrl: [$feed->feed_url]);
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

            $feed->last_error_message = $error;
            $feed->last_failed_refresh_at = now();
            $feed->save();

            Log::withContext([
                'feed_id' => $feed->id,
                'feed_name' => $feed->name,
                'feed_url' => $feed->feed_url,
                'feed_site_url' => $feed->site_url,
                'error' => $error,
            ])->error('Failed to refresh feed');

            throw new FeedCrawlFailedException("Failed to refresh feed: {$error}");
        }

        $feed->last_successful_refresh_at = now();
        $feed->last_error_message = null;
        $feed->save();

        collect($crawledFeed->get_items())->each(function (Item $item) use ($feed) {
            if ($feed->entries()->where('url', $item->get_permalink())->exists()) {
                // TODO: should we update the entry?
                return;
            }

            $feed->entries()->create([
                'title' => $item->get_title(),
                'url' => $item->get_permalink(),
                'author' => $item->get_author()?->get_name(),
                'content' => $item->get_content(),
                'published_at' => $item->get_date('Y-m-d H:i:s'),
            ]);
        });

        Log::withContext([
            'feed_id' => $feed->id,
            'feed_name' => $feed->name,
            'feed_url' => $feed->feed_url,
            'feed_site_url' => $feed->site_url,
            'feed_entries_count' => $feed->entries()->count(),
        ])->info('Feed refreshed');
    }

    public function asController(Feed $feed)
    {
        try {
            $this->handle($feed);
        } catch (FeedCrawlFailedException $e) {
            return redirect()->back()->withErrors([
                'refresh' => $e->getMessage(),
            ]);
            // Alternative:
            // throw ValidationException::withMessages([
            //     'refresh' => 'ups, there was an error',
            // ]);
        }

        return redirect()->route('feed.entries', $feed);
    }
}

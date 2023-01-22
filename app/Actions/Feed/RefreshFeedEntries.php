<?php

namespace App\Actions\Feed;

use App\Exceptions\FeedCrawlFailedException;
use App\Models\Feed;
use Lorisleiva\Actions\Concerns\AsAction;
use SimplePie\Item;

class RefreshFeedEntries
{
    use AsAction;

    public function handle(Feed $feed)
    {
        $crawledFeed = \Feeds::make(feedUrl: [$feed->feed_url]);
        $feed->last_crawled_at = now();
        $feed->save();
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

            throw new FeedCrawlFailedException("Failed to refresh feed: {$error}");
        }

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
                'published_at' => $item->get_date(),
                'status' => \App\Enums\EntryStatus::Unread,
                'starred' => false,
            ]);
        });
    }
}

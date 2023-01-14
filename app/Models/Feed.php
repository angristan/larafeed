<?php

namespace App\Models;

use App\Exceptions\FeedCrawlFailedException;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use SimplePie\Item;
use willvincent\Feeds\Facades\FeedsFacade;

class Feed extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'feed_url',
        'site_url',
        'favicon_url',
    ];

    public function entries()
    {
        return $this->hasMany(Entry::class);
    }

    public function refreshEntries()
    {
        $crawledFeed = FeedsFacade::make([$this->lol]);
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
        collect($crawledFeed->get_items())->each(function (Item $item) {
            if ($this->entries()->where('url', $item->get_permalink())->exists()) {
                // TODO: should we update the entry?
                return;
            }

            $this->entries()->create([
                'title' => $item->get_title(),
                'url' => $item->get_permalink(),
                'author' => $item->get_author()->get_name(),
                'content' => $item->get_content(),
                'published_at' => $item->get_date(),
                'status' => \App\Enums\EntryStatus::Unread,
                'starred' => false,
            ]);
        });
    }
}

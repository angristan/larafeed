<?php

namespace App\Models;

use App\Exceptions\FeedCrawlFailedException;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Laravel\Scout\Searchable;
use SimplePie\Item;

/**
 * App\Models\Feed
 *
 * @property int $id
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property string $name
 * @property string $feed_url
 * @property string $site_url
 * @property string|null $favicon_url
 * @property string $last_crawled_at
 * @property-read \Illuminate\Database\Eloquent\Collection|\App\Models\Entry[] $entries
 * @property-read int|null $entries_count
 *
 * @method static \Database\Factories\FeedFactory factory(...$parameters)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder|Feed newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder|Feed query()
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereFaviconUrl($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereFeedUrl($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereId($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereLastCrawledAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereName($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereSiteUrl($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Feed whereUpdatedAt($value)
 *
 * @mixin \Eloquent
 */
class Feed extends Model
{
    use HasFactory;
    use Searchable;

    /**
     * Get the indexable data array for the model.
     * https://laravel.com/docs/9.x/scout#configuring-searchable-data
     *
     * @return array
     */
    public function toSearchableArray()
    {
        return $this->only([
            'id',
            'name',
            'feed_url',
            'site_url',
        ]);
    }

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
        // TODO fetch limit
        $crawledFeed = \Feeds::make(feedUrl: [$this->feed_url]);
        $this->last_crawled_at = now();
        $this->save();
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

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Laravel\Scout\Searchable;

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
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\Entry> $entries
 * @property-read int|null $entries_count
 *
 * @method static \Database\Factories\FeedFactory factory($count = null, $state = [])
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
}

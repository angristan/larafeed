<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * App\Models\Entry
 *
 * @property int $id
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property string $title
 * @property string $url
 * @property string|null $author
 * @property string|null $content
 * @property string $published_at
 * @property string $status
 * @property bool $starred
 * @property int $feed_id
 * @property-read \App\Models\Feed $feed
 *
 * @method static \Database\Factories\EntryFactory factory(...$parameters)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder|Entry newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder|Entry query()
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereAuthor($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereContent($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereFeedId($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereId($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry wherePublishedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereStarred($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereStatus($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereTitle($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder|Entry whereUrl($value)
 *
 * @mixin \Eloquent
 */
class Entry extends Model
{
    use HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<string>
     */
    protected $fillable = [
        'title',
        'url',
        'author',
        'content',
        'published_at',
        'status',
        'starred',
    ];

    /**
     * Get the feed that owns the entry.
     */
    public function feed()
    {
        return $this->belongsTo(Feed::class);
    }
}

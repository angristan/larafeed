<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $feed_id
 * @property \Illuminate\Support\Carbon $refreshed_at
 * @property bool $was_successful
 * @property int $entries_created
 * @property string|null $error_message
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property-read \App\Models\Feed $feed
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereEntriesCreated($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereErrorMessage($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereFeedId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereRefreshedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedRefresh whereWasSuccessful($value)
 *
 * @mixin \Eloquent
 */
class FeedRefresh extends Model
{
    /** @use HasFactory<\Illuminate\Database\Eloquent\Factories\Factory<self>> */
    use HasFactory;

    protected $fillable = [
        'feed_id',
        'refreshed_at',
        'was_successful',
        'entries_created',
        'error_message',
    ];

    protected $casts = [
        'refreshed_at' => 'datetime',
        'was_successful' => 'boolean',
    ];

    /**
     * @return BelongsTo<Feed, $this>
     */
    public function feed(): BelongsTo
    {
        return $this->belongsTo(Feed::class);
    }
}

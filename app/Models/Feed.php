<?php

declare(strict_types=1);

namespace App\Models;

use App\Actions\Favicon\BuildProxifiedFaviconURL;
use Database\Factories\FeedFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

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
 * @property \Illuminate\Support\Carbon|null $last_successful_refresh_at
 * @property \Illuminate\Support\Carbon|null $last_failed_refresh_at
 * @property string|null $last_error_message
 * @property \Illuminate\Support\Carbon|null $favicon_updated_at
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\Entry> $entries
 * @property-read int|null $entries_count
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\FeedRefresh> $refreshes
 * @property-read int|null $refreshes_count
 * @property-read \App\Models\FeedSubscription|null $subscription
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\User> $users
 * @property-read int|null $users_count
 *
 * @method static \Database\Factories\FeedFactory factory($count = null, $state = [])
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereFaviconUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereFaviconUrl($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereFeedUrl($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereLastErrorMessage($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereLastFailedRefreshAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereLastSuccessfulRefreshAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereName($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereSiteUrl($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereUpdatedAt($value)
 *
 * @mixin \Eloquent
 */
class Feed extends Model
{
    /** @use HasFactory<FeedFactory> */
    use HasFactory;

    protected $fillable = [
        'name',
        'feed_url',
        'site_url',
        'favicon_url',
        'favicon_updated_at',
        'last_successful_refresh_at',
        'last_failed_refresh_at',
        'last_error_message',
    ];

    protected $casts = [
        'last_successful_refresh_at' => 'datetime',
        'last_failed_refresh_at' => 'datetime',
        'favicon_updated_at' => 'datetime',
    ];

    /**
     * @return HasMany<Entry, $this>
     */
    public function entries(): HasMany
    {
        return $this->hasMany(Entry::class);
    }

    /**
     * @return HasMany<FeedRefresh, $this>
     */
    public function refreshes(): HasMany
    {
        return $this->hasMany(FeedRefresh::class);
    }

    /**
     * @return BelongsToMany<User, $this, FeedSubscription, 'subscription'>
     */
    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'feed_subscriptions', 'feed_id', 'user_id')
            ->as('subscription')
            ->using(FeedSubscription::class)
            ->withTimestamps()
            ->withPivot(['custom_feed_name', 'category_id']);
    }

    public function favicon_url(): ?string
    {
        return BuildProxifiedFaviconURL::run($this->favicon_url);
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Actions\Favicon\BuildProfixedFaviconURL;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
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
 * @property string|null $last_successful_refresh_at
 * @property string|null $last_failed_refresh_at
 * @property string|null $last_error_message
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\Entry> $entries
 * @property-read int|null $entries_count
 * @property-read \App\Models\TFactory|null $use_factory
 * @property-read \App\Models\FeedSubscription|null $subscription
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\User> $users
 * @property-read int|null $users_count
 *
 * @method static \Database\Factories\FeedFactory factory($count = null, $state = [])
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Feed whereCreatedAt($value)
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
    use HasFactory;

    protected $fillable = [
        'name',
        'feed_url',
        'site_url',
        'favicon_url',
        'last_successful_refresh_at',
        'last_failed_refresh_at',
        'last_error_message',
    ];

    public function entries(): HasMany
    {
        return $this->hasMany(Entry::class);
    }

    public function users()
    {
        return $this->belongsToMany(User::class, 'feed_subscriptions', 'feed_id', 'user_id')
            ->as('subscription')
            ->using(FeedSubscription::class)
            ->withTimestamps()
            ->withPivot('custom_feed_name');
    }

    public function favicon_url()
    {
        return BuildProfixedFaviconURL::run($this->favicon_url);
    }
}

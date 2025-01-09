<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property int $user_id
 * @property string $name
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\FeedSubscription> $feedsSubscriptions
 * @property-read int|null $feeds_subscriptions_count
 * @property-read \App\Models\User $user
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory whereId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory whereName($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory whereUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|SubscriptionCategory whereUserId($value)
 *
 * @mixin \Eloquent
 */
class SubscriptionCategory extends Model
{
    protected $fillable = [
        'user_id',
        'name',
    ];

    public function user()
    {
        return $this->belongsTo(User::class);
    }

    public function feedsSubscriptions()
    {
        return $this->hasMany(FeedSubscription::class, 'category_id');
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * @property int $user_id
 * @property int $feed_id
 * @property string|null $custom_feed_name
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property int $category_id
 * @property-read \App\Models\SubscriptionCategory $category
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereCategoryId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereCustomFeedName($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereFeedId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereUserId($value)
 *
 * @mixin \Eloquent
 */
class FeedSubscription extends Pivot
{
    protected $table = 'feed_subscriptions';

    public $incrementing = false;

    protected $primaryKey = null;

    protected function setKeysForSaveQuery($query)
    {
        return $query->where('user_id', $this->getAttribute('user_id'))
            ->where('feed_id', $this->getAttribute('feed_id'));
    }

    public function category()
    {
        return $this->belongsTo(SubscriptionCategory::class);
    }
}

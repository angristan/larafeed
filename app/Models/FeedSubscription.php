<?php

declare(strict_types=1);

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * @property int $user_id
 * @property int $feed_id
 * @property string|null $custom_feed_name
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property int $category_id
 * @property array<array-key, mixed>|null $filter_rules
 * @property-read \App\Models\SubscriptionCategory $category
 * @property-read \App\Models\Feed $feed
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereCategoryId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereCustomFeedName($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereFeedId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription whereFilterRules($value)
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

    /**
     * @var array<string, string>
     */
    protected $casts = [
        'filter_rules' => 'array',
    ];

    protected function setKeysForSaveQuery($query)
    {
        return $query->where('user_id', $this->getAttribute('user_id'))
            ->where('feed_id', $this->getAttribute('feed_id'));
    }

    /**
     * @return BelongsTo<SubscriptionCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(SubscriptionCategory::class);
    }

    /**
     * @return BelongsTo<Feed, $this>
     */
    public function feed(): BelongsTo
    {
        return $this->belongsTo(Feed::class);
    }
}

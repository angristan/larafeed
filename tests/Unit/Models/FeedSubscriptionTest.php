<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Feed;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeedSubscriptionTest extends TestCase
{
    use RefreshDatabase;

    public function test_feed_subscription_is_pivot_model(): void
    {
        $subscription = new FeedSubscription;

        $this->assertSame('feed_subscriptions', $subscription->getTable());
    }

    public function test_feed_subscription_belongs_to_category(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, ['category_id' => $category->id]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $this->assertSame($category->id, $subscription->category->id);
    }

    public function test_feed_subscription_belongs_to_feed(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, ['category_id' => $category->id]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $this->assertSame($feed->id, $subscription->feed->id);
    }

    public function test_feed_subscription_stores_filter_rules(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $filterRules = ['exclude_title' => ['alpha', 'beta']];

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'filter_rules' => json_encode($filterRules),
        ]);

        // Access via relationship to get proper pivot casting
        $userFeed = $user->feeds()->where('feeds.id', $feed->id)->first();

        $this->assertNotNull($userFeed);
        $this->assertNotNull($userFeed->subscription->filter_rules);

        // The filter_rules should be stored correctly
        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
        ]);
    }

    public function test_feed_subscription_stores_custom_feed_name(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);
        $feed = Feed::factory()->create();

        $user->feeds()->attach($feed, [
            'category_id' => $category->id,
            'custom_feed_name' => 'My Custom Name',
        ]);

        $subscription = FeedSubscription::where('user_id', $user->id)
            ->where('feed_id', $feed->id)
            ->first();

        $this->assertSame('My Custom Name', $subscription->custom_feed_name);
    }

    public function test_feed_subscription_has_no_incrementing_key(): void
    {
        $subscription = new FeedSubscription;

        $this->assertFalse($subscription->incrementing);
        $this->assertNull($subscription->getKeyName());
    }
}

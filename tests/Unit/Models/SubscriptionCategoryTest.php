<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SubscriptionCategoryTest extends TestCase
{
    use RefreshDatabase;

    public function test_subscription_category_belongs_to_user(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $this->assertSame($user->id, $category->user->id);
    }

    public function test_subscription_category_has_many_feed_subscriptions(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed1 = Feed::factory()->create();
        $feed2 = Feed::factory()->create();

        $user->feeds()->attach($feed1, ['category_id' => $category->id]);
        $user->feeds()->attach($feed2, ['category_id' => $category->id]);

        $this->assertCount(2, $category->feedsSubscriptions);
    }

    public function test_subscription_category_scope_for_user(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user2->id,
            'name' => 'News',
        ]);

        $user1Categories = SubscriptionCategory::forUser($user1)->get();

        $this->assertCount(1, $user1Categories);
        $this->assertSame($category1->id, $user1Categories->first()->id);
    }

    public function test_subscription_category_fillable_attributes(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Technology News',
        ]);

        $this->assertSame($user->id, $category->user_id);
        $this->assertSame('Technology News', $category->name);
    }
}

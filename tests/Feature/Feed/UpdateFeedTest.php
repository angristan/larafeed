<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UpdateFeedTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_update_feed_custom_name(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create(['name' => 'Original Name']);
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'Custom Name',
        ]);

        $response->assertRedirect();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'custom_feed_name' => 'Custom Name',
        ]);
    }

    public function test_user_can_clear_custom_name(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create(['name' => 'Original Name']);
        $user->feeds()->attach($feed->id, [
            'category_id' => $category->id,
            'custom_feed_name' => 'Custom Name',
        ]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => '',
        ]);

        $response->assertRedirect();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'custom_feed_name' => null,
        ]);
    }

    public function test_user_can_change_feed_category(): void
    {
        $user = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'News',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category1->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'category_id' => $category2->id,
        ]);

        $response->assertRedirect();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
            'category_id' => $category2->id,
        ]);
    }

    public function test_user_cannot_change_to_another_users_category(): void
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

        $feed = Feed::factory()->create();
        $user1->feeds()->attach($feed->id, ['category_id' => $category1->id]);

        $this->actingAs($user1);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'category_id' => $category2->id,
        ]);

        $response->assertSessionHasErrors();

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user1->id,
            'feed_id' => $feed->id,
            'category_id' => $category1->id,
        ]);
    }

    public function test_user_cannot_update_unsubscribed_feed(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'Custom Name',
        ]);

        $response->assertSessionHasErrors();
    }

    public function test_name_max_length_is_255(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => str_repeat('a', 256),
        ]);

        $response->assertSessionHasErrors('name');
    }

    public function test_unauthenticated_user_cannot_update_feed(): void
    {
        $feed = Feed::factory()->create();

        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'Custom Name',
        ]);

        $response->assertRedirect(route('login'));
    }

    public function test_name_not_persisted_when_category_validation_fails(): void
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

        $feed = Feed::factory()->create();
        $user1->feeds()->attach($feed->id, ['category_id' => $category1->id]);

        $this->actingAs($user1);

        // Send both name and invalid category_id
        $response = $this->patch(route('feed.update', ['feed_id' => $feed->id]), [
            'name' => 'New Custom Name',
            'category_id' => $category2->id,
        ]);

        $response->assertSessionHasErrors();

        // Verify name was NOT changed (atomic - all or nothing)
        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user1->id,
            'feed_id' => $feed->id,
            'category_id' => $category1->id,
            'custom_feed_name' => null,
        ]);
    }
}

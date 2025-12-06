<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Models\Entry;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UnsubscribeFromFeedTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_unsubscribe_from_feed(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $response->assertRedirect();

        $this->assertDatabaseMissing('feed_subscriptions', [
            'user_id' => $user->id,
            'feed_id' => $feed->id,
        ]);
    }

    public function test_feed_is_deleted_when_no_subscribers_remain(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $this->assertDatabaseMissing('feeds', [
            'id' => $feed->id,
        ]);
    }

    public function test_feed_is_not_deleted_when_other_subscribers_remain(): void
    {
        $user1 = User::factory()->create();
        $user2 = User::factory()->create();

        $category1 = SubscriptionCategory::create([
            'user_id' => $user1->id,
            'name' => 'Tech',
        ]);

        $category2 = SubscriptionCategory::create([
            'user_id' => $user2->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user1->feeds()->attach($feed->id, ['category_id' => $category1->id]);
        $user2->feeds()->attach($feed->id, ['category_id' => $category2->id]);

        $this->actingAs($user1);

        $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $this->assertDatabaseHas('feeds', [
            'id' => $feed->id,
        ]);

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user2->id,
            'feed_id' => $feed->id,
        ]);
    }

    public function test_entry_interactions_are_deleted_on_unsubscribe(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $entry = Entry::factory()->create(['feed_id' => $feed->id]);
        $entry->markAsRead($user);

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);

        $this->actingAs($user);

        $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $this->assertDatabaseMissing('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);
    }

    public function test_unauthenticated_user_cannot_unsubscribe(): void
    {
        $feed = Feed::factory()->create();

        $response = $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $response->assertRedirect(route('login'));
    }

    public function test_user_cannot_unsubscribe_from_feed_they_are_not_subscribed_to(): void
    {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $otherUser->id,
            'name' => 'Tech',
        ]);

        // Feed belongs to another user
        $feed = Feed::factory()->create();
        $otherUser->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $response = $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $response->assertSessionHasErrors();

        // Feed should still exist and other user should still be subscribed
        $this->assertDatabaseHas('feeds', [
            'id' => $feed->id,
        ]);

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $otherUser->id,
            'feed_id' => $feed->id,
        ]);
    }

    public function test_user_cannot_delete_feed_by_unsubscribing_from_nonexistent_subscription(): void
    {
        $user = User::factory()->create();

        // Create a feed with no subscriptions initially
        $feed = Feed::factory()->create();

        $this->actingAs($user);

        $response = $this->delete(route('feed.unsubscribe', ['feed_id' => $feed->id]));

        $response->assertSessionHasErrors();

        // Feed should still exist
        $this->assertDatabaseHas('feeds', [
            'id' => $feed->id,
        ]);
    }
}

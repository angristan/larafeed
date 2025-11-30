<?php

declare(strict_types=1);

namespace Tests\Feature\User;

use App\Models\Entry;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class WipeAccountTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_wipe_account_data(): void
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

        $this->actingAs($user);

        $response = $this->post(route('profile.wipe'));

        $response->assertRedirect();

        // Interactions should be deleted
        $this->assertDatabaseMissing('entry_interactions', [
            'user_id' => $user->id,
        ]);

        // Subscriptions should be deleted
        $this->assertDatabaseMissing('feed_subscriptions', [
            'user_id' => $user->id,
        ]);

        // Categories should be deleted
        $this->assertDatabaseMissing('subscription_categories', [
            'user_id' => $user->id,
        ]);

        // User should still exist
        $this->assertDatabaseHas('users', [
            'id' => $user->id,
        ]);
    }

    public function test_wipe_deletes_orphaned_feeds(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $this->actingAs($user);

        $this->post(route('profile.wipe'));

        // Feed should be deleted since no other subscribers
        $this->assertDatabaseMissing('feeds', [
            'id' => $feed->id,
        ]);
    }

    public function test_wipe_preserves_feeds_with_other_subscribers(): void
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

        $this->post(route('profile.wipe'));

        // Feed should still exist since user2 is subscribed
        $this->assertDatabaseHas('feeds', [
            'id' => $feed->id,
        ]);

        // User2's subscription should be intact
        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user2->id,
            'feed_id' => $feed->id,
        ]);
    }

    public function test_wipe_does_not_affect_other_users_data(): void
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
        $user2->feeds()->attach($feed->id, ['category_id' => $category2->id]);

        $entry = Entry::factory()->create(['feed_id' => $feed->id]);
        $entry->markAsRead($user1);
        $entry->markAsRead($user2);

        $this->actingAs($user1);

        $this->post(route('profile.wipe'));

        // User2's data should be intact
        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user2->id,
            'entry_id' => $entry->id,
        ]);

        $this->assertDatabaseHas('subscription_categories', [
            'user_id' => $user2->id,
            'name' => 'News',
        ]);

        $this->assertDatabaseHas('feed_subscriptions', [
            'user_id' => $user2->id,
            'feed_id' => $feed->id,
        ]);
    }

    public function test_unauthenticated_user_cannot_wipe(): void
    {
        $response = $this->post(route('profile.wipe'));

        $response->assertRedirect(route('login'));
    }
}

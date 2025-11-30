<?php

declare(strict_types=1);

namespace Tests\Feature\Feed;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MarkEntriesAsReadTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_mark_all_entries_as_read(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $entry1 = Entry::factory()->create(['feed_id' => $feed->id]);
        $entry2 = Entry::factory()->create(['feed_id' => $feed->id]);
        $entry3 = Entry::factory()->create(['feed_id' => $feed->id]);

        $this->actingAs($user);

        $response = $this->post(route('feed.mark-read', ['feed_id' => $feed->id]));

        $response->assertRedirect();

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry1->id,
        ]);

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry2->id,
        ]);

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry3->id,
        ]);

        // All should have read_at set
        $interactions = EntryInteraction::where('user_id', $user->id)->get();
        $this->assertCount(3, $interactions);
        foreach ($interactions as $interaction) {
            $this->assertNotNull($interaction->read_at);
        }
    }

    public function test_marks_existing_unread_interactions_as_read(): void
    {
        $user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $feed = Feed::factory()->create();
        $user->feeds()->attach($feed->id, ['category_id' => $category->id]);

        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        // Create an unread interaction (starred but not read)
        $entry->favorite($user);

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);

        $this->actingAs($user);

        $this->post(route('feed.mark-read', ['feed_id' => $feed->id]));

        // Verify both starred_at is preserved and read_at is now set
        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);

        $interaction = \App\Models\EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNotNull($interaction->read_at);
        $this->assertNotNull($interaction->starred_at); // Starred status preserved
    }

    public function test_user_cannot_mark_unsubscribed_feed_as_read(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();

        $this->actingAs($user);

        $response = $this->post(route('feed.mark-read', ['feed_id' => $feed->id]));

        $response->assertSessionHasErrors();
    }

    public function test_does_not_affect_other_users_interactions(): void
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

        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $this->actingAs($user1);

        $this->post(route('feed.mark-read', ['feed_id' => $feed->id]));

        // User 1 should have interaction
        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $user1->id,
            'entry_id' => $entry->id,
        ]);

        // User 2 should not have interaction
        $this->assertDatabaseMissing('entry_interactions', [
            'user_id' => $user2->id,
            'entry_id' => $entry->id,
        ]);
    }

    public function test_unauthenticated_user_cannot_mark_as_read(): void
    {
        $feed = Feed::factory()->create();

        $response = $this->post(route('feed.mark-read', ['feed_id' => $feed->id]));

        $response->assertRedirect(route('login'));
    }
}

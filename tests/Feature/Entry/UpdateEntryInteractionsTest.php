<?php

declare(strict_types=1);

namespace Tests\Feature\Entry;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class UpdateEntryInteractionsTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Feed $feed;

    private Entry $entry;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create();

        $category = SubscriptionCategory::create([
            'user_id' => $this->user->id,
            'name' => 'Tech',
        ]);

        $this->feed = Feed::factory()->create();
        $this->user->feeds()->attach($this->feed->id, ['category_id' => $category->id]);

        $this->entry = Entry::factory()->create(['feed_id' => $this->feed->id]);
    }

    public function test_user_can_mark_entry_as_read(): void
    {
        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'read' => true,
        ]);

        $response->assertRedirect();

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->read_at);
    }

    public function test_user_can_mark_entry_as_unread(): void
    {
        $this->entry->markAsRead($this->user);

        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'read' => false,
        ]);

        $response->assertRedirect();

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNull($interaction->read_at);
    }

    public function test_user_can_star_entry(): void
    {
        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'starred' => true,
        ]);

        $response->assertRedirect();

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->starred_at);
    }

    public function test_user_can_unstar_entry(): void
    {
        $this->entry->favorite($this->user);

        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'starred' => false,
        ]);

        $response->assertRedirect();

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNull($interaction->starred_at);
    }

    public function test_user_can_archive_entry(): void
    {
        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'archived' => true,
        ]);

        $response->assertRedirect();

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->archived_at);
    }

    public function test_user_can_unarchive_entry(): void
    {
        $this->entry->archive($this->user);

        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'archived' => false,
        ]);

        $response->assertRedirect();

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNull($interaction->archived_at);
    }

    public function test_user_cannot_update_entry_from_unsubscribed_feed(): void
    {
        $otherFeed = Feed::factory()->create();
        $otherEntry = Entry::factory()->create(['feed_id' => $otherFeed->id]);

        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $otherEntry->id]), [
            'read' => true,
        ]);

        $response->assertSessionHasErrors();

        $this->assertDatabaseMissing('entry_interactions', [
            'user_id' => $this->user->id,
            'entry_id' => $otherEntry->id,
        ]);
    }

    public function test_updating_nonexistent_entry_returns_error(): void
    {
        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => 99999]), [
            'read' => true,
        ]);

        $response->assertSessionHasErrors();
    }

    public function test_request_without_action_returns_error(): void
    {
        $this->actingAs($this->user);

        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), []);

        $response->assertSessionHasErrors();
    }

    public function test_unauthenticated_user_cannot_update_entry(): void
    {
        $response = $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'read' => true,
        ]);

        $response->assertRedirect(route('login'));
    }

    public function test_multiple_interactions_preserve_each_other(): void
    {
        // First star the entry
        $this->entry->favorite($this->user);

        $this->actingAs($this->user);

        // Then mark as read
        $this->patch(route('entry.update', ['entry_id' => $this->entry->id]), [
            'read' => true,
        ]);

        $interaction = EntryInteraction::where('user_id', $this->user->id)
            ->where('entry_id', $this->entry->id)
            ->first();

        // Both should be set
        $this->assertNotNull($interaction->read_at);
        $this->assertNotNull($interaction->starred_at);
    }
}

<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EntryTest extends TestCase
{
    use RefreshDatabase;

    public function test_entry_belongs_to_feed(): void
    {
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $this->assertSame($feed->id, $entry->feed->id);
    }

    public function test_entry_scope_for_user(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $subscribedFeed = Feed::factory()->create();
        $unsubscribedFeed = Feed::factory()->create();

        $user->feeds()->attach($subscribedFeed, ['category_id' => $category->id]);

        $subscribedEntry = Entry::factory()->create(['feed_id' => $subscribedFeed->id]);
        $unsubscribedEntry = Entry::factory()->create(['feed_id' => $unsubscribedFeed->id]);

        $userEntries = Entry::forUser($user)->get();

        $this->assertCount(1, $userEntries);
        $this->assertSame($subscribedEntry->id, $userEntries->first()->id);
    }

    public function test_entry_has_users_relationship(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
            'read_at' => now(),
        ]);

        $this->assertTrue($entry->users()->exists());
        $this->assertSame($user->id, $entry->users()->first()->id);
    }

    public function test_mark_as_read(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->markAsRead($user);

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->read_at);
    }

    public function test_mark_as_unread(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        // First mark as read
        $entry->markAsRead($user);

        // Then mark as unread
        $entry->markAsUnread($user);

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNull($interaction->read_at);
    }

    public function test_favorite(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->favorite($user);

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->starred_at);
    }

    public function test_unfavorite(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->favorite($user);
        $entry->unfavorite($user);

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNull($interaction->starred_at);
    }

    public function test_archive(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->archive($user);

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNotNull($interaction->archived_at);
    }

    public function test_unarchive(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->archive($user);
        $entry->unarchive($user);

        $interaction = EntryInteraction::where('user_id', $user->id)
            ->where('entry_id', $entry->id)
            ->first();

        $this->assertNotNull($interaction);
        $this->assertNull($interaction->archived_at);
    }

    public function test_interaction_upsert_creates_new_record(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->markAsRead($user);

        $this->assertSame(1, EntryInteraction::count());
    }

    public function test_interaction_upsert_updates_existing_record(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $entry->markAsRead($user);
        $entry->favorite($user);

        $this->assertSame(1, EntryInteraction::count());

        $interaction = EntryInteraction::first();
        $this->assertNotNull($interaction->read_at);
        $this->assertNotNull($interaction->starred_at);
    }
}

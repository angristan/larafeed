<?php

declare(strict_types=1);

namespace Tests\Unit\Models;

use App\Models\Entry;
use App\Models\EntryInteraction;
use App\Models\Feed;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class EntryInteractionTest extends TestCase
{
    use RefreshDatabase;

    public function test_entry_interaction_is_pivot_model(): void
    {
        $interaction = new EntryInteraction;

        $this->assertSame('entry_interactions', $interaction->getTable());
    }

    public function test_entry_interaction_stores_all_fields(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        $now = now();

        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
            'read_at' => $now,
            'starred_at' => $now,
            'archived_at' => $now,
            'filtered_at' => $now,
        ]);

        $interaction = EntryInteraction::first();

        $this->assertSame($user->id, $interaction->user_id);
        $this->assertSame($entry->id, $interaction->entry_id);
        $this->assertNotNull($interaction->read_at);
        $this->assertNotNull($interaction->starred_at);
        $this->assertNotNull($interaction->archived_at);
        $this->assertNotNull($interaction->filtered_at);
    }

    public function test_entry_interaction_can_have_null_timestamps(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);

        $interaction = EntryInteraction::first();

        $this->assertNull($interaction->read_at);
        $this->assertNull($interaction->starred_at);
        $this->assertNull($interaction->archived_at);
        $this->assertNull($interaction->filtered_at);
    }

    public function test_entry_interaction_has_composite_key(): void
    {
        $user = User::factory()->create();
        $feed = Feed::factory()->create();
        $entry = Entry::factory()->create(['feed_id' => $feed->id]);

        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);

        // Attempting to create another interaction with same keys should fail
        $this->expectException(\Illuminate\Database\QueryException::class);

        EntryInteraction::create([
            'user_id' => $user->id,
            'entry_id' => $entry->id,
        ]);
    }
}

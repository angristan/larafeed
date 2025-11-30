<?php

declare(strict_types=1);

namespace Tests\Feature\API;

use App\Models\Entry;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FeverAPITest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Feed $feed;

    private SubscriptionCategory $category;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create([
            'fever_api_key' => 'test-api-key',
        ]);

        $this->category = SubscriptionCategory::create([
            'user_id' => $this->user->id,
            'name' => 'Tech',
        ]);

        $this->feed = Feed::factory()->create([
            'last_successful_refresh_at' => now(),
        ]);
        $this->user->feeds()->attach($this->feed->id, ['category_id' => $this->category->id]);
    }

    public function test_unauthenticated_request_returns_auth_0(): void
    {
        $response = $this->post('/api/fever');

        $response->assertOk();
        $response->assertJson([
            'api_version' => 3,
            'auth' => 0,
        ]);
    }

    public function test_invalid_api_key_returns_auth_0(): void
    {
        $response = $this->post('/api/fever', [
            'api_key' => 'invalid-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'api_version' => 3,
            'auth' => 0,
        ]);
    }

    public function test_valid_api_key_returns_auth_1(): void
    {
        $response = $this->post('/api/fever', [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'api_version' => 3,
            'auth' => 1,
        ]);
    }

    public function test_get_groups(): void
    {
        $response = $this->post('/api/fever?groups', [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'auth' => 1,
        ]);
        $response->assertJsonStructure([
            'groups',
            'feeds_groups',
        ]);
    }

    public function test_get_feeds(): void
    {
        $response = $this->post('/api/fever?feeds', [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'auth' => 1,
        ]);
        $response->assertJsonStructure([
            'feeds',
            'feeds_groups',
        ]);

        $feeds = $response->json('feeds');
        $this->assertCount(1, $feeds);
        $this->assertSame($this->feed->id, $feeds[0]['id']);
    }

    public function test_get_items(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->post('/api/fever?items', [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'auth' => 1,
        ]);
        $response->assertJsonStructure([
            'items',
            'total_items',
        ]);

        $items = $response->json('items');
        $this->assertCount(1, $items);
        $this->assertSame($entry->id, $items[0]['id']);
    }

    public function test_get_items_with_ids(): void
    {
        $entry1 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry2 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        Entry::factory()->create(['feed_id' => $this->feed->id]); // Third entry not requested

        $response = $this->post('/api/fever?items', [
            'api_key' => 'test-api-key',
            'with_ids' => "{$entry1->id},{$entry2->id}",
        ]);

        $response->assertOk();

        $items = $response->json('items');
        $this->assertCount(2, $items);
    }

    public function test_get_unread_item_ids(): void
    {
        $entry1 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry2 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry2->markAsRead($this->user);

        $response = $this->post('/api/fever?unread_item_ids', [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'auth' => 1,
        ]);

        $unreadIds = $response->json('unread_item_ids');
        $this->assertStringContainsString((string) $entry1->id, $unreadIds);
        $this->assertStringNotContainsString((string) $entry2->id, $unreadIds);
    }

    public function test_get_saved_item_ids(): void
    {
        $entry1 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry2 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry1->favorite($this->user);

        $response = $this->post('/api/fever?saved_item_ids', [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();
        $response->assertJson([
            'auth' => 1,
        ]);

        $savedIds = $response->json('saved_item_ids');
        $this->assertStringContainsString((string) $entry1->id, $savedIds);
        $this->assertStringNotContainsString((string) $entry2->id, $savedIds);
    }

    public function test_mark_item_as_read(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->post('/api/fever?mark=item&as=read&id='.$entry->id, [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $this->user->id,
            'entry_id' => $entry->id,
        ]);
    }

    public function test_mark_item_as_saved(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->post('/api/fever?mark=item&as=save&id='.$entry->id, [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $this->user->id,
            'entry_id' => $entry->id,
        ]);

        $interaction = $this->user->entriesInteracted()
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNotNull($interaction->interaction->starred_at);
    }

    public function test_mark_item_as_unsaved(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry->favorite($this->user);

        $response = $this->post('/api/fever?mark=item&as=unsaved&id='.$entry->id, [
            'api_key' => 'test-api-key',
        ]);

        $response->assertOk();

        $interaction = $this->user->entriesInteracted()
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNull($interaction->interaction->starred_at);
    }
}

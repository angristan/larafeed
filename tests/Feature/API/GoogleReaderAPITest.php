<?php

declare(strict_types=1);

namespace Tests\Feature\API;

use App\Models\Entry;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class GoogleReaderAPITest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    private Feed $feed;

    private SubscriptionCategory $category;

    private string $authToken;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create([
            'password' => bcrypt('password123'),
        ]);

        $this->category = SubscriptionCategory::create([
            'user_id' => $this->user->id,
            'name' => 'Tech',
        ]);

        $this->feed = Feed::factory()->create();
        $this->user->feeds()->attach($this->feed->id, ['category_id' => $this->category->id]);

        // Create auth token
        $this->authToken = 'test-auth-token-123';
        $this->user->tokens()->create([
            'name' => 'reader-auth-token',
            'token' => hash('sha256', $this->authToken),
            'abilities' => ['reader-api'],
        ]);
    }

    public function test_client_login_with_valid_credentials(): void
    {
        $response = $this->post('/api/reader/accounts/ClientLogin', [
            'Email' => $this->user->email,
            'Passwd' => 'password123',
        ]);

        $response->assertOk();
        $response->assertJsonStructure([
            'Auth',
            'SID',
            'LSID',
        ]);
    }

    public function test_client_login_with_invalid_credentials(): void
    {
        $response = $this->post('/api/reader/accounts/ClientLogin', [
            'Email' => $this->user->email,
            'Passwd' => 'wrongpassword',
        ]);

        $response->assertStatus(403);
        $this->assertStringContainsString('BadAuthentication', $response->getContent());
    }

    public function test_client_login_with_nonexistent_user(): void
    {
        $response = $this->post('/api/reader/accounts/ClientLogin', [
            'Email' => 'nonexistent@example.com',
            'Passwd' => 'password123',
        ]);

        $response->assertStatus(403);
    }

    public function test_request_without_auth_header_returns_401(): void
    {
        $response = $this->get('/api/reader/reader/api/0/user-info');

        $response->assertStatus(401);
        $this->assertStringContainsString('AuthRequired', $response->getContent());
    }

    public function test_request_with_invalid_token_returns_403(): void
    {
        $response = $this->get('/api/reader/reader/api/0/user-info', [
            'Authorization' => 'GoogleLogin auth=invalid-token',
        ]);

        $response->assertStatus(403);
        $this->assertStringContainsString('InvalidAuthToken', $response->getContent());
    }

    public function test_get_user_info(): void
    {
        $response = $this->get('/api/reader/reader/api/0/user-info', [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();
        $response->assertJson([
            'userId' => (string) $this->user->id,
            'userName' => $this->user->name,
            'userEmail' => $this->user->email,
        ]);
    }

    public function test_get_token(): void
    {
        $response = $this->get('/api/reader/reader/api/0/token', [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();
        $this->assertNotEmpty($response->getContent());
    }

    public function test_get_subscription_list(): void
    {
        $response = $this->get('/api/reader/reader/api/0/subscription/list', [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();
        $response->assertJsonStructure([
            'subscriptions',
        ]);

        $subscriptions = $response->json('subscriptions');
        $this->assertCount(1, $subscriptions);
        $this->assertSame('feed/'.$this->feed->id, $subscriptions[0]['id']);
    }

    public function test_get_stream_item_ids(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->get('/api/reader/reader/api/0/stream/items/ids', [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();
        $response->assertJsonStructure([
            'itemRefs',
        ]);
    }

    public function test_get_stream_item_ids_with_unread_filter(): void
    {
        $entry1 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry2 = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry2->markAsRead($this->user);

        $response = $this->get('/api/reader/reader/api/0/stream/items/ids?s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read', [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();

        $itemRefs = $response->json('itemRefs');
        $itemIds = array_column($itemRefs, 'id');

        // Only unread entry should be returned
        $this->assertContains((string) $entry1->id, $itemIds);
        $this->assertNotContains((string) $entry2->id, $itemIds);
    }

    public function test_get_stream_contents(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->post('/api/reader/reader/api/0/stream/items/contents', [
            'i' => dechex($entry->id),
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();
        $response->assertJsonStructure([
            'items',
        ]);
    }

    public function test_edit_tag_mark_as_read(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->post('/api/reader/reader/api/0/edit-tag', [
            'i' => dechex($entry->id),
            'a' => 'user/-/state/com.google/read',
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();
        $this->assertSame('OK', $response->getContent());

        $this->assertDatabaseHas('entry_interactions', [
            'user_id' => $this->user->id,
            'entry_id' => $entry->id,
        ]);

        $interaction = $this->user->entriesInterracted()
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNotNull($interaction->interaction->read_at);
    }

    public function test_edit_tag_mark_as_unread(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry->markAsRead($this->user);

        $response = $this->post('/api/reader/reader/api/0/edit-tag', [
            'i' => dechex($entry->id),
            'r' => 'user/-/state/com.google/read',
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();

        $interaction = $this->user->entriesInterracted()
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNull($interaction->interaction->read_at);
    }

    public function test_edit_tag_star_item(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);

        $response = $this->post('/api/reader/reader/api/0/edit-tag', [
            'i' => dechex($entry->id),
            'a' => 'user/-/state/com.google/starred',
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();

        $interaction = $this->user->entriesInterracted()
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNotNull($interaction->interaction->starred_at);
    }

    public function test_edit_tag_unstar_item(): void
    {
        $entry = Entry::factory()->create(['feed_id' => $this->feed->id]);
        $entry->favorite($this->user);

        $response = $this->post('/api/reader/reader/api/0/edit-tag', [
            'i' => dechex($entry->id),
            'r' => 'user/-/state/com.google/starred',
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();

        $interaction = $this->user->entriesInterracted()
            ->where('entry_id', $entry->id)
            ->first();
        $this->assertNull($interaction->interaction->starred_at);
    }

    public function test_user_cannot_edit_tag_on_entry_from_unsubscribed_feed(): void
    {
        // Create a feed and entry that the user is NOT subscribed to
        $otherFeed = Feed::factory()->create();
        $otherEntry = Entry::factory()->create(['feed_id' => $otherFeed->id]);

        $response = $this->post('/api/reader/reader/api/0/edit-tag', [
            'i' => dechex($otherEntry->id),
            'a' => 'user/-/state/com.google/read',
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();

        // No interaction should be created
        $this->assertDatabaseMissing('entry_interactions', [
            'user_id' => $this->user->id,
            'entry_id' => $otherEntry->id,
        ]);
    }

    public function test_user_cannot_star_entry_from_unsubscribed_feed(): void
    {
        // Create a feed and entry that the user is NOT subscribed to
        $otherFeed = Feed::factory()->create();
        $otherEntry = Entry::factory()->create(['feed_id' => $otherFeed->id]);

        $response = $this->post('/api/reader/reader/api/0/edit-tag', [
            'i' => dechex($otherEntry->id),
            'a' => 'user/-/state/com.google/starred',
        ], [
            'Authorization' => 'GoogleLogin auth='.$this->authToken,
        ]);

        $response->assertOk();

        // No interaction should be created
        $this->assertDatabaseMissing('entry_interactions', [
            'user_id' => $this->user->id,
            'entry_id' => $otherEntry->id,
        ]);
    }
}

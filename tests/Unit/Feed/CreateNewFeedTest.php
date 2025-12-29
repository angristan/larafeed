<?php

declare(strict_types=1);

namespace Tests\Unit\Feed;

use App\Actions\Feed\CreateNewFeed;
use App\Actions\Feed\FetchFeed;
use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use SimplePie\SimplePie;
use Tests\TestCase;

class CreateNewFeedTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        parent::tearDown();
        Mockery::close();
    }

    public function test_creates_new_feed_and_subscribes_user(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $mockFeed = Mockery::mock(SimplePie::class);
        $mockFeed->shouldReceive('get_title')->andReturn('Test Feed');
        $mockFeed->shouldReceive('get_link')->andReturn('https://example.com');
        $mockFeed->shouldReceive('get_items')->andReturn([]);

        $this->mock(FetchFeed::class, function ($mock) use ($mockFeed) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => true,
                    'feed' => $mockFeed,
                ]);
        });

        $action = new CreateNewFeed;
        $response = $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id
        );

        $this->assertDatabaseHas('feeds', [
            'name' => 'Test Feed',
            'feed_url' => 'https://example.com/feed.xml',
            'site_url' => 'https://example.com',
        ]);

        $this->assertTrue($user->feeds()->where('feed_url', 'https://example.com/feed.xml')->exists());
    }

    public function test_attaches_existing_feed_to_new_user(): void
    {
        $existingFeed = Feed::factory()->create([
            'feed_url' => 'https://example.com/feed.xml',
        ]);

        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $mockFeed = Mockery::mock(SimplePie::class);
        $mockFeed->shouldReceive('get_title')->andReturn('Test Feed');
        $mockFeed->shouldReceive('get_link')->andReturn('https://example.com');

        $this->mock(FetchFeed::class, function ($mock) use ($mockFeed) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => true,
                    'feed' => $mockFeed,
                ]);
        });

        $action = new CreateNewFeed;
        $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id
        );

        // Should not create a duplicate feed
        $this->assertSame(1, Feed::where('feed_url', 'https://example.com/feed.xml')->count());

        // User should be subscribed
        $this->assertTrue($user->feeds()->where('feed_url', 'https://example.com/feed.xml')->exists());
    }

    public function test_returns_error_when_user_already_subscribed(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $existingFeed = Feed::factory()->create([
            'feed_url' => 'https://example.com/feed.xml',
        ]);

        $user->feeds()->attach($existingFeed, ['category_id' => $category->id]);

        $mockFeed = Mockery::mock(SimplePie::class);
        $mockFeed->shouldReceive('get_title')->andReturn('Test Feed');
        $mockFeed->shouldReceive('get_link')->andReturn('https://example.com');

        $this->mock(FetchFeed::class, function ($mock) use ($mockFeed) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => true,
                    'feed' => $mockFeed,
                ]);
        });

        $action = new CreateNewFeed;
        $response = $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id
        );

        $this->assertTrue($response->isRedirect());
        $this->assertNotEmpty(session('errors'));
    }

    public function test_returns_error_when_fetch_fails(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $this->mock(FetchFeed::class, function ($mock) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => false,
                    'error' => 'Connection timeout',
                ]);
        });

        $action = new CreateNewFeed;
        $response = $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id
        );

        $this->assertTrue($response->isRedirect());
        $this->assertDatabaseMissing('feeds', [
            'feed_url' => 'https://example.com/feed.xml',
        ]);
    }

    public function test_force_mode_skips_failed_feeds_silently(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $this->mock(FetchFeed::class, function ($mock) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => false,
                    'error' => 'Connection timeout',
                ]);
        });

        $action = new CreateNewFeed;
        $response = $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id,
            force: true
        );

        $this->assertTrue($response->isRedirect());
        // No error should be present in force mode
        $this->assertEmpty(session('errors'));
    }

    public function test_uses_fallback_name_when_feed_has_no_title(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $mockFeed = Mockery::mock(SimplePie::class);
        $mockFeed->shouldReceive('get_title')->andReturn(null);
        $mockFeed->shouldReceive('get_link')->andReturn('https://example.com');
        $mockFeed->shouldReceive('get_items')->andReturn([]);

        $this->mock(FetchFeed::class, function ($mock) use ($mockFeed) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => true,
                    'feed' => $mockFeed,
                ]);
        });

        $action = new CreateNewFeed;
        $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id,
            fallback_name: 'My Fallback Name'
        );

        $this->assertDatabaseHas('feeds', [
            'name' => 'My Fallback Name',
            'feed_url' => 'https://example.com/feed.xml',
        ]);
    }

    public function test_decodes_html_entities_in_feed_name(): void
    {
        $user = User::factory()->create();
        $category = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $mockFeed = Mockery::mock(SimplePie::class);
        $mockFeed->shouldReceive('get_title')->andReturn('Tech &amp; Science');
        $mockFeed->shouldReceive('get_link')->andReturn('https://example.com');
        $mockFeed->shouldReceive('get_items')->andReturn([]);

        $this->mock(FetchFeed::class, function ($mock) use ($mockFeed) {
            $mock->shouldReceive('handle')
                ->once()
                ->andReturn([
                    'success' => true,
                    'feed' => $mockFeed,
                ]);
        });

        $action = new CreateNewFeed;
        $action->handle(
            'https://example.com/feed.xml',
            $user,
            $category->id
        );

        $this->assertDatabaseHas('feeds', [
            'name' => 'Tech & Science',
        ]);
    }
}

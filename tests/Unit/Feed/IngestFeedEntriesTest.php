<?php

declare(strict_types=1);

namespace Tests\Unit\Feed;

use App\Actions\Feed\IngestFeedEntries;
use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Mockery;
use SimplePie\Item;
use Tests\TestCase;

class IngestFeedEntriesTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        parent::tearDown();
        Mockery::close();
    }

    public function test_ingests_new_entries(): void
    {
        $feed = Feed::factory()->create();

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('John Doe');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article-1');
        $item->shouldReceive('get_title')->andReturn('Test Article');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Article content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(1, $entries);
        $this->assertDatabaseHas('entries', [
            'feed_id' => $feed->id,
            'url' => 'https://example.com/article-1',
            'title' => 'Test Article',
            'author' => 'John Doe',
        ]);
    }

    public function test_skips_duplicate_entries_by_url(): void
    {
        $feed = Feed::factory()->create();

        Entry::factory()->create([
            'feed_id' => $feed->id,
            'url' => 'https://example.com/existing-article',
        ]);

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Jane Doe');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/existing-article');
        $item->shouldReceive('get_title')->andReturn('Existing Article');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(0, $entries);
        $this->assertSame(1, Entry::where('feed_id', $feed->id)->count());
    }

    public function test_skips_entries_without_url(): void
    {
        $feed = Feed::factory()->create();

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn(null);
        $item->shouldReceive('get_title')->andReturn('Test Article');
        $item->shouldReceive('get_author')->andReturn(null);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(0, $entries);
        $this->assertSame(0, Entry::where('feed_id', $feed->id)->count());
    }

    public function test_skips_entries_without_title(): void
    {
        $feed = Feed::factory()->create();

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn(null);
        $item->shouldReceive('get_author')->andReturn(null);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(0, $entries);
    }

    public function test_skips_entries_with_empty_title(): void
    {
        $feed = Feed::factory()->create();

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('   ');
        $item->shouldReceive('get_author')->andReturn(null);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(0, $entries);
    }

    public function test_limits_entries_when_limit_provided(): void
    {
        $feed = Feed::factory()->create();

        $items = [];
        for ($i = 1; $i <= 5; $i++) {
            $author = Mockery::mock();
            $author->shouldReceive('get_name')->andReturn('Author');

            $item = Mockery::mock(Item::class);
            $item->shouldReceive('get_permalink')->andReturn("https://example.com/article-{$i}");
            $item->shouldReceive('get_title')->andReturn("Article {$i}");
            $item->shouldReceive('get_author')->andReturn($author);
            $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
            $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));
            $items[] = $item;
        }

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, $items, limit: 3);

        $this->assertCount(3, $entries);
        $this->assertSame(3, Entry::where('feed_id', $feed->id)->count());
    }

    public function test_truncates_long_author_names(): void
    {
        $feed = Feed::factory()->create();

        $longAuthorName = str_repeat('a', 300);

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn($longAuthorName);

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('Test Article');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(1, $entries);
        $this->assertSame(255, strlen(Entry::first()->author));
    }

    public function test_truncates_long_titles(): void
    {
        $feed = Feed::factory()->create();

        $longTitle = str_repeat('a', 300);

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn($longTitle);
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(1, $entries);
        $this->assertSame(255, strlen(Entry::first()->title));
    }

    public function test_decodes_html_entities_in_title(): void
    {
        $feed = Feed::factory()->create();

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('Tech &amp; Science');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertSame('Tech & Science', Entry::first()->title);
    }

    public function test_handles_null_author(): void
    {
        $feed = Feed::factory()->create();

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('Test Article');
        $item->shouldReceive('get_author')->andReturn(null);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(1, $entries);
        $this->assertSame('', Entry::first()->author);
    }

    public function test_handles_null_content(): void
    {
        $feed = Feed::factory()->create();

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('Test Article');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn(null);
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(1, $entries);
        $this->assertSame('', Entry::first()->content);
    }

    public function test_uses_current_time_when_no_date_provided(): void
    {
        $feed = Feed::factory()->create();

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $item = Mockery::mock(Item::class);
        $item->shouldReceive('get_permalink')->andReturn('https://example.com/article');
        $item->shouldReceive('get_title')->andReturn('Test Article');
        $item->shouldReceive('get_author')->andReturn($author);
        $item->shouldReceive('get_content')->andReturn('<p>Content</p>');
        $item->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(null);

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item]);

        $this->assertCount(1, $entries);
        $this->assertNotNull(Entry::first()->published_at);
    }

    public function test_prevents_duplicates_within_same_batch(): void
    {
        $feed = Feed::factory()->create();

        $author = Mockery::mock();
        $author->shouldReceive('get_name')->andReturn('Author');

        $item1 = Mockery::mock(Item::class);
        $item1->shouldReceive('get_permalink')->andReturn('https://example.com/same-article');
        $item1->shouldReceive('get_title')->andReturn('Same Article');
        $item1->shouldReceive('get_author')->andReturn($author);
        $item1->shouldReceive('get_content')->andReturn('<p>Content 1</p>');
        $item1->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $item2 = Mockery::mock(Item::class);
        $item2->shouldReceive('get_permalink')->andReturn('https://example.com/same-article');
        $item2->shouldReceive('get_title')->andReturn('Same Article Duplicate');
        $item2->shouldReceive('get_author')->andReturn($author);
        $item2->shouldReceive('get_content')->andReturn('<p>Content 2</p>');
        $item2->shouldReceive('get_date')->with('Y-m-d H:i:s')->andReturn(now()->format('Y-m-d H:i:s'));

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, [$item1, $item2]);

        $this->assertCount(1, $entries);
        $this->assertSame(1, Entry::where('feed_id', $feed->id)->count());
    }

    public function test_returns_empty_collection_when_no_items(): void
    {
        $feed = Feed::factory()->create();

        $action = new IngestFeedEntries;
        $entries = $action->handle($feed, []);

        $this->assertCount(0, $entries);
    }
}

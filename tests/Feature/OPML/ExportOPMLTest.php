<?php

declare(strict_types=1);

namespace Tests\Feature\OPML;

use App\Models\Feed;
use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use SimpleXMLElement;
use Tests\TestCase;

class ExportOPMLTest extends TestCase
{
    use RefreshDatabase;

    public function test_exported_opml_groups_feeds_by_category(): void
    {
        $user = User::factory()->create();

        $newsCategory = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'News',
        ]);

        $techCategory = SubscriptionCategory::create([
            'user_id' => $user->id,
            'name' => 'Tech',
        ]);

        $newsFeed = Feed::factory()->create([
            'name' => 'Daily News',
            'feed_url' => 'https://news.example.com/rss.xml',
            'site_url' => 'https://news.example.com',
        ]);

        $techFeed = Feed::factory()->create([
            'name' => 'Tech Radar',
            'feed_url' => 'https://tech.example.com/feed',
            'site_url' => 'https://tech.example.com',
        ]);

        $alphaFeed = Feed::factory()->create([
            'name' => 'Alpha Dev',
            'feed_url' => 'https://alpha.dev/rss',
            'site_url' => 'https://alpha.dev',
        ]);

        $user->feeds()->attach($newsFeed->id, [
            'category_id' => $newsCategory->id,
        ]);

        $user->feeds()->attach($techFeed->id, [
            'category_id' => $techCategory->id,
            'custom_feed_name' => 'Custom Tech',
        ]);

        $user->feeds()->attach($alphaFeed->id, [
            'category_id' => $techCategory->id,
        ]);

        $this->actingAs($user);

        $response = $this->get(route('export.download'));

        $response->assertOk();
        $this->assertStringStartsWith('text/xml', (string) $response->headers->get('Content-Type'));
        $response->assertHeader('Content-Disposition', 'attachment; filename="feeds.opml"');

        $xml = new SimpleXMLElement($response->getContent());

        $this->assertSame('LaraFeed Export', (string) $xml->head->title);
        $this->assertNotEmpty((string) $xml->head->dateCreated);

        $categoryNames = [];
        foreach ($xml->body->outline as $categoryElement) {
            $categoryNames[] = (string) $categoryElement['text'];
        }

        $this->assertEqualsCanonicalizing(['News', 'Tech'], $categoryNames);

        $newsFeeds = $xml->xpath('/opml/body/outline[@text="News"]/outline');
        $this->assertIsArray($newsFeeds);
        $this->assertCount(1, $newsFeeds);
        $this->assertSame('Daily News', (string) $newsFeeds[0]['title']);
        $this->assertSame('Daily News', (string) $newsFeeds[0]['text']);
        $this->assertSame('https://news.example.com/rss.xml', (string) $newsFeeds[0]['xmlUrl']);
        $this->assertSame('https://news.example.com', (string) $newsFeeds[0]['htmlUrl']);
        $this->assertSame('rss', (string) $newsFeeds[0]['type']);
        $this->assertFalse(isset($newsFeeds[0]['custom_title']));

        $techFeeds = $xml->xpath('/opml/body/outline[@text="Tech"]/outline');
        $this->assertIsArray($techFeeds);
        $this->assertCount(2, $techFeeds);
        $this->assertEqualsCanonicalizing(['Alpha Dev', 'Custom Tech'], array_map(fn ($node) => (string) $node['title'], $techFeeds));

        $techFeedsByTitle = [];
        foreach ($techFeeds as $node) {
            $techFeedsByTitle[(string) $node['title']] = $node;
        }

        $alphaNode = $techFeedsByTitle['Alpha Dev'];
        $this->assertSame('Alpha Dev', (string) $alphaNode['text']);
        $this->assertSame('https://alpha.dev/rss', (string) $alphaNode['xmlUrl']);
        $this->assertFalse(isset($alphaNode['custom_title']));

        $customNode = $techFeedsByTitle['Custom Tech'];
        $this->assertSame('Custom Tech', (string) $customNode['text']);
        $this->assertSame('https://tech.example.com/feed', (string) $customNode['xmlUrl']);
        $this->assertSame('Custom Tech', (string) $customNode['custom_title']);
    }
}

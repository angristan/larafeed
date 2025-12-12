<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;
use SimplePie\Item;

class IngestFeedEntries
{
    use AsAction;

    /**
     * @param  array<Item>  $items
     * @return Collection<int, Entry>
     */
    public function handle(Feed $feed, array $items, ?int $limit = null): Collection
    {
        if ($limit !== null) {
            $items = array_slice($items, 0, $limit);
        }

        // Pre-fetch existing URLs to avoid N+1 queries
        /** @var array<string, bool> $existingUrls */
        $existingUrls = $feed->entries()->pluck('url')->flip()->all();

        /** @var Collection<int, Entry> $newEntries */
        $newEntries = collect();

        DB::transaction(function () use ($feed, $items, $existingUrls, &$newEntries) {
            foreach ($items as $item) {
                $data = $this->extractEntryData($item, $feed);

                if ($data === null) {
                    continue;
                }

                if (isset($existingUrls[$data['url']])) {
                    continue;
                }

                $entry = $feed->entries()->create($data);
                $newEntries->push($entry);

                // Track newly created URLs to prevent duplicates within the same batch
                $existingUrls[$data['url']] = true;
            }
        });

        return $newEntries;
    }

    /**
     * @return array{title: string, url: string, author: string, content: string, published_at: \Illuminate\Support\Carbon|string}|null
     */
    private function extractEntryData(Item $item, Feed $feed): ?array
    {
        $url = $item->get_permalink();
        $title = $item->get_title();
        $content = $item->get_content() ?? '';

        if ($url === null) {
            $this->report($feed, $item, 'Entry missing URL');

            return null;
        }

        if ($title === null || trim($title) === '') {
            $this->report($feed, $item, 'Entry missing title');

            return null;
        }

        $author = $item->get_author()?->get_name() ?? '';
        if (strlen($author) > 255) {
            $this->report($feed, $item, 'Author name too long');
            $author = substr($author, 0, 255);
        }

        $title = str_replace('&amp;', '&', $title);
        $title = substr($title, 0, 255);

        return [
            'url' => $url,
            'title' => $title,
            'author' => $author,
            'content' => $content,
            'published_at' => $item->get_date('Y-m-d H:i:s') ?? now(),
        ];
    }

    private function report(Feed $feed, Item $item, string $message): void
    {
        $context = [
            'feed' => [
                'id' => $feed->id,
                'url' => $feed->feed_url,
            ],
            'entry' => [
                'title' => $item->get_title(),
                'url' => $item->get_permalink(),
                'author' => $item->get_author()?->get_name(),
            ],
        ];

        Log::warning($message, $context);

        \Sentry\withScope(function (\Sentry\State\Scope $scope) use ($context, $message): void {
            foreach ($context as $key => $value) {
                $scope->setContext($key, $value);
            }

            \Sentry\captureMessage($message);
        });
    }
}

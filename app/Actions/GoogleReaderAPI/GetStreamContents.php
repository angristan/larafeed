<?php

declare(strict_types=1);

namespace App\Actions\GoogleReaderAPI;

use App\Models\Entry;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class GetStreamContents
{
    use AsAction;

    public function asController(Request $request): \Illuminate\Http\JsonResponse
    {
        $continuation = $request->input('c', null);
        $excludeTargets = explode('|', $request->input('xt', ''));
        $streamId = $request->input('s', 'user/'.Auth::id().'/state/com.google/reading-list');

        // This endpoint receives a URL-encoded form like:
        //
        // i:      00000000000104da
        // i:      0000000000011308
        // i:      0000000000010e76
        // i:      00000000000107bc
        // i:      000000000001125a
        // i:      0000000000011258
        // i:      000000000001131d
        // output: json
        // T:      stan/4a4d5e914b8bf5222e46f6c8f99f8b00935f23ba
        //
        // However laravel only keeps a single value of `i` in $request->input
        // So we need to get the raw body and extract the entry IDs from it

        $rawForm = file_get_contents('php://input'); // Get the raw POST body
        $parsedData = [];
        foreach (explode('&', $rawForm) as $pair) {
            $parts = explode('=', $pair);
            $key = urldecode($parts[0]);
            $value = isset($parts[1]) ? urldecode($parts[1]) : null;

            // Collect multiple values for the same key
            if (! isset($parsedData[$key])) {
                $parsedData[$key] = [];
            }
            $parsedData[$key][] = $value;
        }
        $entryIDs = collect($parsedData['i'] ?? []);
        $entryIDs = $entryIDs->map(function ($item) {
            // Convert hex ID to decimal
            return base_convert($item, 16, 10);
        });

        $query = Entry::query()
            ->whereIn('entries.id', $entryIDs)
            ->join('feeds', 'entries.feed_id', '=', 'feeds.id')
            ->join('feed_subscriptions', function ($join) {
                $join->on('feeds.id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->join('subscription_categories', 'feed_subscriptions.category_id', '=', 'subscription_categories.id')
            ->leftJoin('entry_interactions', function ($join) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', Auth::id());
            })
            ->select([
                'entries.id',
                'entries.title',
                'entries.url',
                'entries.content',
                'entries.author',
                'entries.published_at',
                'entries.created_at',
                'feeds.feed_url',
                'feeds.id as feed_id',
                'feeds.site_url as feed_site_url',
                'feeds.name as feed_name',
                'entry_interactions.read_at as read_at',
                'entry_interactions.starred_at',
                'subscription_categories.name as category_name',
            ])
            ->orderBy('entries.published_at', 'desc');

        // Handle stream type filtering
        if (str_contains($streamId, '/state/com.google/starred')) {
            $query->whereNotNull('entry_interactions.starred_at');
        } elseif (str_contains($streamId, '/state/com.google/read')) {
            // $query->whereNotNull('entry_interactions.read_at');
        } elseif (str_contains($streamId, 'feed/')) {
            $feedUrl = str_replace('feed/', '', $streamId);
            $query->where('feeds.feed_url', $feedUrl);
        }

        // Handle exclusions
        if (in_array('user/'.Auth::id().'/state/com.google/read', $excludeTargets)) {
            $query->whereNull('entry_interactions.read_at');
        }

        // Handle continuation
        if ($continuation) {
            $query->where('entries.published_at', '<', Carbon::createFromTimestamp($continuation));
        }

        // $entries = $query->limit($limit)->get();
        $entries = $query->get();

        // Format entries according to Google Reader API spec
        $items = $entries->map(function ($entry) {
            $item = [
                'id' => 'tag:google.com,2005:reader/item/'.str_pad(base_convert((string) $entry->id, 10, 16), 16, '0', STR_PAD_LEFT),
                'title' => $entry->title,
                'timestampUsec' => number_format(Carbon::parse($entry->published_at)->getPreciseTimestamp(6), 0, '', ''),
                'crawlTimeMsec' => (string) $entry->created_at->getTimestampMs(),
                'published' => Carbon::parse($entry->published_at)->getTimestamp(),
                'updated' => Carbon::parse($entry->updated_at)->getTimestamp(),
                'alternate' => [
                    [
                        'href' => $entry->url,
                        'type' => 'text/html',
                    ],
                ],
                'content' => [
                    'direction' => 'ltr',
                    'content' => $entry->content,
                ],
                'origin' => [
                    'streamId' => 'feed/'.$entry->feed_id,
                    'title' => $entry['feed_name'],
                    'htmlUrl' => $entry['feed_site_url'],
                ],
                'enclosures' => [],
                'categories' => [
                    'user/'.Auth::id().'/state/com.google/reading-list',
                    'user/'.Auth::id().'/label/'.$entry['category_name'],
                ],
                'canonical' => [
                    [
                        'href' => $entry->url,
                    ],
                ],
            ];

            if ($entry['read_at']) {
                $item['categories'][] = 'user/'.Auth::id().'/state/com.google/read';
            }

            if ($entry['starred_at']) {
                $item['categories'][] = 'user/'.Auth::id().'/state/com.google/starred';
            }

            if ($entry->author) {
                $item['author'] = $entry->author;
            }

            return $item;
        });

        $firstEntry = $entries->first();

        return response()->json([
            'items' => $items,
            // I'm not sure if all of this below is useful
            'updated' => Carbon::now()->getTimestamp(),
            'direction' => 'ltr',
            'self' => [
                [
                    'href' => 'http://localhost:8000/api/reader/reader/api/0/stream/items/contents',
                ],
            ],
            'alternate' => [
                [
                    'href' => $firstEntry->feed_url ?? '',
                    'type' => 'text/html',
                ],
            ],
            'author' => 'larafeed',
            'id' => 'feed/'.($firstEntry->feed_id ?? ''),
            'title' => $firstEntry->feed_name ?? '',
            // 'continuation' => $entries->last()?->published_at ?
            // Carbon::parse($entries->last()->published_at)->getTimestampMs() : null,
        ]);
    }
}

<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreFeedRequest;
use App\Models\Entry;
use App\Models\Feed;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Illuminate\Http\Request;
use Inertia\Inertia;

class FeedController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): \Inertia\Response
    {
        $search_input = $request->query('search');

        $feeds = Feed::query($search_input)->withCount('entries')->get()->map(function (Feed $feed) {
            return $feed->only([
                'id',
                'name',
                'feed_url',
                'site_url',
                'favicon_url',
                'last_crawled_at',
                'entries_count',
            ]);
        });

        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Feeds', [
            'filters' => [
                'search' => $search_input,
            ],
            'feeds' => $feeds,
            'entries' => Entry::query()->orderByDesc('published_at')->with('feed:id,favicon_url,name')->latest()->limit(100)->get(),
            'currententry' => Inertia::lazy(fn () => Entry::whereId($request->query('entry'))->first()),
        ]);
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(StoreFeedRequest $request): \Illuminate\Http\RedirectResponse
    {
        $feed_url = '';
        $feed_url = $request->validated()['feed_url'];

        // TODO fetch limit
        $crawledFeed = \Feeds::make(feedUrl: $feed_url);
        if ($crawledFeed->error()) {
            $error = '';
            if (is_array($crawledFeed->error())) {
                $error = implode(', ', $crawledFeed->error());
            } else {
                $error = $crawledFeed->error();
            }
            // "cURL error 3: " -> "cURL error 3"
            // idk why it adds a colon at the end
            $error = rtrim($error, ': ');

            return redirect()->back()->withErrors([
                'feed_url' => $error,
            ]);
        }

        // Handle feeds without site link such as https://aggregate.stitcher.io/rss
        $site_url = $crawledFeed->get_link() ?? $feed_url;

        // TODO fix + cache/store + refresh
        $favicon_url = Favicon::withFallback('favicon-kit')->fetch($site_url)?->getFaviconUrl();

        $feed = Feed::create([
            'name' => $crawledFeed->get_title(),
            'feed_url' => $feed_url,
            'site_url' => $site_url,
            'favicon_url' => $favicon_url,
        ]);

        // TODO single insert
        $entries = $crawledFeed->get_items();
        foreach ($entries as $entry) {
            $feed->entries()->create([
                'title' => $entry->get_title(),
                'url' => $entry->get_permalink(),
                'content' => $entry->get_content(),
                'published_at' => $entry->get_date('Y-m-d H:i:s'),
            ]);
        }

        return redirect()->route('feed.entries', $feed)
        // TODO success message
        // https://inertiajs.com/shared-data#flash-messages
            ->with('success', 'Feed added successfully.');
    }
}

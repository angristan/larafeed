<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreFeedRequest;
use App\Models\Entry;
use App\Models\Feed;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Brendt\SparkLine\SparkLine;
use Brendt\SparkLine\SparkLineDay;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;

class FeedController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index(Request $request): \Inertia\Response
    {
        $search_input = $request->query('search');

        $feeds_data = Feed::search($search_input)->get();

        $feeds = $feeds_data->map(function (Feed $feed) {
            $days = DB::query()
                ->from((new Entry)->getTable())
                ->selectRaw('DATE(published_at) as published_at_day, COUNT(*) as publishes')
                ->where('feed_id', $feed->id)
                ->groupBy('published_at_day')
                ->orderByDesc('published_at_day')
                ->limit(20)
                ->get()
                ->map(fn (object $row) => new SparkLineDay(
                    count: $row->publishes,
                    day: Carbon::make($row->published_at_day),
                ));

            $sparkLine = SparkLine::new($days)
                ->withStrokeWidth(2)
                ->withDimensions(200, 50)
                ->withMaxItemAmount(30);
            // ->withMaxValue(10);

            return collect($feed->only([
                'id',
                'name',
                'feed_url',
                'site_url',
                'favicon_url',
                'last_crawled_at',
            ]))->merge([
                'entries_count' => $feed->entries()->count(),
                'sparkline' => $sparkLine->make(),
            ]);
        });

        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Feeds', [
            'filters' => [
                'search' => $search_input,
            ],
            'feeds' => $feeds,
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

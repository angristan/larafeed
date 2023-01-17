<?php

namespace App\Http\Controllers;

use App\Exceptions\FeedCrawlFailedException;
use App\Http\Requests\StoreFeedRequest;
use App\Http\Requests\UpdateFeedRequest;
use App\Models\Feed;
use AshAllenDesign\FaviconFetcher\Facades\Favicon;
use Inertia\Inertia;

class FeedController extends Controller
{
    /**
     * Display a listing of the resource.
     *
     * @return \Inertia\Response
     */
    public function index(): \Inertia\Response
    {
        // TODO https://laravel.com/docs/9.x/eloquent-resources
        return Inertia::render('Feeds', [
            'feeds' => Feed::all()->map(function (Feed $feed) {
                return collect($feed->only([
                    'id',
                    'name',
                    'feed_url',
                    'site_url',
                    'favicon_url',
                    'last_crawled_at',
                ]))->merge([
                    'entries_count' => $feed->entries()->count(),
                ]);
            }),
        ]);
    }

    /**
     * Show the form for creating a new resource.
     *
     * @return \Inertia\Response
     */
    public function create(): \Inertia\Response
    {
        return Inertia::render('Feed/New');
    }

    /**
     * Store a newly created resource in storage.
     *
     * @param  \App\Http\Requests\StoreFeedRequest  $request
     * @return \Illuminate\Http\RedirectResponse
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

        // TODO fix + cache/store + refresh
        $favicon_url = Favicon::withFallback('favicon-kit')->fetch($crawledFeed->get_link())?->getFaviconUrl();

        $feed = Feed::create([
            'name' => $crawledFeed->get_title(),
            'feed_url' => $feed_url,
            'site_url' => $crawledFeed->get_link(),
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

    /**
     * Display the specified resource.
     *
     * @param  \App\Models\Feed  $feed
     * @return \Inertia\Response
     */
    public function show(Feed $feed): \Inertia\Response
    {
        // TODO: https://www.eoghanobrien.com/posts/define-a-custom-collection-for-your-eloquent-model
        return Inertia::render('Feed/Entries', [
            'feed' => collect($feed->only([
                'id',
                'name',
                'feed_url',
                'site_url',
                'favicon_url',
                'last_crawled_at',
            ]))->merge([
                'entries_count' => $feed->entries()->count(),
            ]),
            'entries' => $feed->entries()->orderBy('published_at', 'desc')->get(),
        ]);
    }

    /**
     * Crawl the feed and get new entries.
     *
     * @param  \App\Models\Feed  $feed
     * @return \Illuminate\Http\RedirectResponse
     */
    public function refresh(Feed $feed): \Illuminate\Http\RedirectResponse
    {
        try {
            $feed->refreshEntries();
        } catch (FeedCrawlFailedException $e) {
            return redirect()->back()->withErrors([
                'refresh' => $e->getMessage(),
            ]);
            // Alternative:
            // throw ValidationException::withMessages([
            //     'refresh' => 'ups, there was an error',
            // ]);
        }

        return redirect()->route('feed.entries', $feed);
    }

    /**
     * Display the specified entry.
     *
     * @param  \App\Models\Feed  $feed
     * @param  int  $entryId
     * @return \Inertia\Response
     */
    public function showEntry(Feed $feed, int $entryId): \Inertia\Response
    {
        $entry = $feed->entries()->findOrFail($entryId);

        return Inertia::render('Feed/Entry', [
            'feed' => $feed,
            'entry' => $entry,
        ]);
    }

    // /**
    //  * Show the form for editing the specified resource.
    //  *
    //  * @param  \App\Models\Feed  $feed
    //  * @return \Illuminate\Http\Response
    //  */
    // public function edit(Feed $feed): \Illuminate\Http\Response
    // {
    //     //
    // }

    // /**
    //  * Update the specified resource in storage.
    //  *
    //  * @param  \App\Http\Requests\UpdateFeedRequest  $request
    //  * @param  \App\Models\Feed  $feed
    //  * @return \Illuminate\Http\Response
    //  */
    // public function update(UpdateFeedRequest $request, Feed $feed): \Illuminate\Http\Response
    // {
    //     //
    // }

    // /**
    //  * Remove the specified resource from storage.
    //  *
    //  * @param  \App\Models\Feed  $feed
    //  * @return \Illuminate\Http\Response
    //  */
    // public function destroy(Feed $feed): \Illuminate\Http\Response
    // {
    //     //
    // }
}

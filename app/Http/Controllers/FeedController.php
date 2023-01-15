<?php

namespace App\Http\Controllers;

use App\Exceptions\FeedCrawlFailedException;
use App\Http\Requests\StoreFeedRequest;
use App\Http\Requests\UpdateFeedRequest;
use App\Models\Feed;
use Inertia\Inertia;

class FeedController extends Controller
{
    /**
     * Display a listing of the resource.
     *
     * @return \Inertia\Response
     */
    public function index()
    {
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
     * @return \Illuminate\Http\Response
     */
    public function create()
    {
        //
    }

    /**
     * Store a newly created resource in storage.
     *
     * @param  \App\Http\Requests\StoreFeedRequest  $request
     * @return \Illuminate\Http\Response
     */
    public function store(StoreFeedRequest $request)
    {
        //
    }

    /**
     * Display the specified resource.
     *
     * @param  \App\Models\Feed  $feed
     * @return \Inertia\Response
     */
    public function show(Feed $feed)
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
    public function refresh(Feed $feed)
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
    public function showEntry(Feed $feed, $entryId)
    {
        $entry = $feed->entries()->findOrFail($entryId);

        return Inertia::render('Feed/Entry', [
            'feed' => $feed,
            'entry' => $entry,
        ]);
    }

    /**
     * Show the form for editing the specified resource.
     *
     * @param  \App\Models\Feed  $feed
     * @return \Illuminate\Http\Response
     */
    public function edit(Feed $feed)
    {
        //
    }

    /**
     * Update the specified resource in storage.
     *
     * @param  \App\Http\Requests\UpdateFeedRequest  $request
     * @param  \App\Models\Feed  $feed
     * @return \Illuminate\Http\Response
     */
    public function update(UpdateFeedRequest $request, Feed $feed)
    {
        //
    }

    /**
     * Remove the specified resource from storage.
     *
     * @param  \App\Models\Feed  $feed
     * @return \Illuminate\Http\Response
     */
    public function destroy(Feed $feed)
    {
        //
    }
}

<?php

declare(strict_types=1);

namespace App\Actions;

use App\Actions\Feed\CreateNewFeed;
use App\Models\EntryInteraction;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ImportOPML
{
    use AsAction;

    public function index(): \Inertia\Response
    {
        return Inertia::render('OPMLImportExport');
    }

    public function store(Request $request): \Illuminate\Http\RedirectResponse
    {
        $file = $request->file('opml_file');

        if (! $file || ! ($xml = simplexml_load_file($file->getPathname()))) {
            throw new \Exception('Unable to parse OPML file');
        }

        // TODO: make this optional
        EntryInteraction::where('user_id', Auth::user()->id)->delete();
        FeedSubscription::where('user_id', Auth::user()->id)->delete();

        foreach ($xml->body->outline as $category_outline) {
            foreach ($category_outline->outline as $feed_outline) {
                $feed_url = (string) $feed_outline['xmlUrl'];
                $feed_name = (string) $feed_outline['title'];

                $category = SubscriptionCategory::firstOrCreate([
                    'user_id' => Auth::user()->id,
                    'name' => (string) $category_outline['text'],
                ]);

                Log::info("[OPML] Importing feed: {$feed_url} for user: ".Auth::user()->id);

                CreateNewFeed::dispatch($feed_url, Auth::user(), $category->id, true, $feed_name);
            }
        }

        return redirect()->route('import.index');
    }
}

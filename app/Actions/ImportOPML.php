<?php

declare(strict_types=1);

namespace App\Actions;

use App\Actions\Feed\CreateNewFeed;
use App\Models\EntryInteraction;
use App\Models\FeedSubscription;
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

        $xml = simplexml_load_file($file);

        // TODO: make this optional
        EntryInteraction::where('user_id', Auth::user()->id)->delete();
        FeedSubscription::where('user_id', Auth::user()->id)->delete();

        foreach ($xml->body->outline as $category) {
            foreach ($category->outline as $outline) {
                $feed_url = (string) $outline['xmlUrl'];

                Log::info("[OPML] Importing feed: {$feed_url} for user: ".Auth::user()->id);

                CreateNewFeed::dispatch($feed_url, Auth::user());
            }
        }

        return redirect()->route('import.index');
    }
}

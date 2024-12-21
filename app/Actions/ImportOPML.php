<?php

namespace App\Actions;

use App\Actions\Feed\CreateNewFeed;
use App\Models\Entry;
use App\Models\Feed;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ImportOPML
{
    use AsAction;

    public function index(): \Inertia\Response
    {
        return Inertia::render('Import');
    }

    public function store(Request $request): \Illuminate\Http\RedirectResponse
    {
        $file = $request->file('opml_file');

        $xml = simplexml_load_file($file);

        // TODO: make this optional
        Entry::query()->delete();
        Feed::query()->delete();

        foreach ($xml->body->outline as $category) {
            foreach ($category->outline as $outline) {
                $feed_url = (string) $outline['xmlUrl'];

                CreateNewFeed::dispatch($feed_url);
            }
        }

        return redirect()->route('import.index');
    }
}

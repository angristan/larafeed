<?php

declare(strict_types=1);

namespace App\Actions\OPML;

use App\Actions\Feed\CreateNewFeed;
use App\Models\EntryInteraction;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class ImportOPML
{
    use AsAction;

    public function index(): \Illuminate\Http\RedirectResponse
    {
        return redirect()->route('profile.edit', ['section' => 'opml']);
    }

    public function store(Request $request): \Illuminate\Http\RedirectResponse
    {
        $file = $request->file('opml_file');

        if (! $file) {
            throw new \Exception('No OPML file provided');
        }

        $content = file_get_contents($file->getPathname());

        if ($content === false) {
            throw new \Exception('Unable to read OPML file');
        }

        // Disable network access to prevent XXE attacks (SSRF, external entity loading)
        // Use internal error handling to capture libxml errors
        $previousUseErrors = libxml_use_internal_errors(true);

        $xml = simplexml_load_string($content, 'SimpleXMLElement', LIBXML_NONET);

        $errors = libxml_get_errors();
        libxml_clear_errors();
        libxml_use_internal_errors($previousUseErrors);

        if ($xml === false) {
            $errorMessage = ! empty($errors) ? $errors[0]->message : 'Unknown XML error';
            throw new \Exception('Unable to parse OPML file: '.trim($errorMessage));
        }

        // TODO: make this optional
        DB::transaction(function () use ($xml) {
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
        });

        return redirect()->route('profile.edit', ['section' => 'opml']);
    }
}

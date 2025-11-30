<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use App\Models\Entry;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Cache;
use Lorisleiva\Actions\Concerns\AsAction;
use Prism\Prism\Enums\Provider;
use Prism\Prism\Facades\Prism;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class SummarizeEntryWithLLM
{
    use AsAction;

    public function handle(Entry $entry): string
    {

        $prompt = <<<EOT
Please provide a concise summary of the following article in 3-4 sentences.
Focus on the main points and key takeaways.
Maintain a neutral, informative tone.
Use bullet points if appropriate, but at least don't write a wall of text, break it down into paragraphs (HTML).
If the entry is from an aggregator like hacker news and there is no content, only links or
if the article in only an excerpt, don't summarize it,
just say in a single sentence that you cannot summarize it and why.
Don't use first person language, use passive voice.
Use simple english.
Return the summary as HTML, WITHOUT any additional formatting (like ```)
Here's the article:

{$entry->content}
EOT;

        $summary = Cache::remember(
            "entry_{$entry->id}_llm_summary",
            now()->addDays(30),
            function () use ($prompt) {
                return Prism::text()
                    ->using(Provider::Gemini, 'gemini-2.0-flash')
                    ->withPrompt($prompt)
                    ->withMaxTokens(512)
                    ->generate()->text;
            }
        );

        return $summary;
    }

    public function asController(Entry $entry): JsonResponse
    {
        // Verify the authenticated user has access to this entry's feed
        $userHasAccess = Auth::user()
            ->feeds()
            ->where('feeds.id', $entry->feed_id)
            ->exists();

        if (! $userHasAccess) {
            throw new NotFoundHttpException('Entry not found');
        }

        $summary = $this->handle($entry);

        return response()->json([
            'summary' => $summary,
        ]);
    }
}

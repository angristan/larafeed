<?php

declare(strict_types=1);

namespace App\Actions\Entry;

use App\Models\Entry;
use DDTrace\Trace;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Lorisleiva\Actions\Concerns\AsAction;
use Prism\Prism\Enums\Provider;
use Prism\Prism\Facades\Prism;

class SummarizeEntryWithLLM
{
    use AsAction;

    #[Trace(name: 'entry.summarize_llm', tags: ['domain' => 'entries', 'llm' => 'true'])]
    public function handle(Entry $entry): string
    {
        $span = function_exists('DDTrace\active_span') ? \DDTrace\active_span() : null;
        if ($span) {
            $span->meta['entry.id'] = (string) $entry->id;
            $span->meta['entry.title'] = $entry->title;
            $span->meta['llm.provider'] = 'gemini';
            $span->meta['llm.model'] = 'gemini-2.0-flash';
        }

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

        $cacheHit = Cache::has("entry_{$entry->id}_llm_summary");

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

        if ($span) {
            $span->meta['cache.hit'] = $cacheHit ? 'true' : 'false';
            $span->metrics['summary.length'] = strlen($summary);
        }

        return $summary;
    }

    public function asController(Entry $entry): JsonResponse
    {
        $summary = $this->handle($entry);

        return response()->json([
            'summary' => $summary,
        ]);
    }
}

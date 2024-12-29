<?php

namespace App\Actions\Entry;

use App\Models\Entry;
use EchoLabs\Prism\Enums\Provider;
use EchoLabs\Prism\Prism;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Lorisleiva\Actions\Concerns\AsAction;

class SummarizeEntryWithLLM
{
    use AsAction;

    public function handle(Entry $entry): string
    {

        $prompt = <<<EOT
Please provide a concise summary of the following article in 2-3 sentences.
Focus on the main points and key takeaways.
Maintain a neutral, informative tone.
Use bullet points if appropriate.
If the content appears incomplete or unclear, mention that in your summary.
Return the summary as HTML, WITHOUT any additional formatting.
Here's the article:

{$entry->content}
EOT;

        $summary = Cache::remember(
            "entry-{$entry->id}-llm-summary",
            now()->addDays(30),
            function () use ($prompt) {
                return Prism::text()
                    ->using(Provider::OpenAI, 'gpt-4o-mini')
                    ->withPrompt($prompt)
                    ->withMaxTokens(256)
                    ->generate()->text;
            }
        );

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

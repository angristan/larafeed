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
        $summary = Cache::remember("entry-{$entry->id}-llm-summary", 60 * 60 * 24, function () use ($entry) {
            return Prism::text()
                ->using(Provider::OpenAI, 'gpt-4o-mini')
                ->withPrompt('Summarize this article: '.$entry->content)
                ->withMaxTokens(256)
                ->generate()->text;
        });

        return $summary->text;
    }

    public function asController(Entry $entry): JsonResponse
    {
        $summary = $this->handle($entry);

        return response()->json([
            'summary' => $summary,
        ]);
    }
}

<?php

namespace App\Actions\Entry;

use App\Models\Entry;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Lorisleiva\Actions\Concerns\AsAction;
use OpenAI\Laravel\Facades\OpenAI;

class SummarizeEntryWithGPTChat
{
    use AsAction;

    public function handle(Entry $entry): string
    {
        // https://laravel.com/docs/9.x/cache
        $summary = Cache::remember("entry-{$entry->id}-gpt-summary", 60 * 60 * 24, function () use ($entry) {
            $result = OpenAI::completions()->create([
                'model' => 'text-davinci-003',
                'prompt' => "Summarize this text: {$entry->content}",
                // 'temperature' => 0.7,
                'max_tokens' => 256,
                // 'top_p' => 1,
                // 'frequency_penalty' => 0,
                // 'presence_penalty' => 0,
            ]);

            return $result->choices[0]->text;
        });

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

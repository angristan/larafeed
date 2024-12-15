<?php

namespace App\Actions\Entry;

use App\Models\Entry;
use Gioni06\Gpt3Tokenizer\Gpt3Tokenizer;
use Gioni06\Gpt3Tokenizer\Gpt3TokenizerConfig;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Lorisleiva\Actions\Concerns\AsAction;
use OpenAI\Laravel\Facades\OpenAI;

class SummarizeEntryWithChatGPT
{
    use AsAction;

    public function handle(Entry $entry): string
    {
        $MAX_MODEL_TOKENS = 4097;
        $COMPLETION_SIZE = 256;
        $PROMPT_SIZE = $MAX_MODEL_TOKENS - $COMPLETION_SIZE;
        /*
            Workaround for ChatGPT error "this model's maximum context length is 4097 tokens"
            GPT tokens explanation and demo: https://beta.openai.com/tokenizer
        */
        $config = new Gpt3TokenizerConfig;
        $tokenizer = new Gpt3Tokenizer($config);
        // Convert text to tokens
        $tokens = $tokenizer->encode($entry->content);
        // Keep only the first 4097 minus completion size tokens
        $truncated_tokens = array_slice($tokens, 0, $PROMPT_SIZE);
        // Convert tokens back to text using the vocab files
        // (https://github.com/Gioni06/GPT3Tokenizer/tree/6638c4b0355f38819338171cc629fede9a0c6256/src/pretrained_vocab_files)
        $truncated_content = $tokenizer->decode($truncated_tokens);

        // Here is our prompt... Valid, but truncated.
        $prompt = "Summarize this text: {$truncated_content}";

        // https://laravel.com/docs/9.x/cache
        $summary = Cache::remember("entry-{$entry->id}-gpt-summary", 60 * 60 * 24, function () use ($prompt) {
            $result = OpenAI::completions()->create([
                'model' => 'text-davinci-003',
                'prompt' => $prompt,
                'max_tokens' => 256,
                // 'temperature' => 0.7,
                // 'top_p' => 1,
                // 'frequency_penalty' => 0,
                // 'presence_penalty' => 0,
            ]);

            return $result->choices[0]->text;
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

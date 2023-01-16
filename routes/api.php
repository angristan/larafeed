<?php

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use OpenAI\Laravel\Facades\OpenAI;

/*
|--------------------------------------------------------------------------
| API Routes
|--------------------------------------------------------------------------
|
| Here is where you can register API routes for your application. These
| routes are loaded by the RouteServiceProvider within a group which
| is assigned the "api" middleware group. Enjoy building your API!
|
*/

Route::middleware('auth:sanctum')->get('/user', function (Request $request) {
    return $request->user();
});

// https://laravel.com/docs/9.x/sanctum#sanctum-middleware
Route::middleware('auth:sanctum')->get('/entry/{entry}/gpt-summary', function (Entry $entry) {
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

    return response()->json([
        'summary' => $summary,
    ]);
})->name('entry.gpt-summary');

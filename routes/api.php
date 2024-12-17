<?php

use App\Actions\Entry\SummarizeEntryWithLLM;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::middleware(['auth:sanctum'])->group(function () {
    Route::get('/entry/{entry}/gpt-summary', SummarizeEntryWithLLM::class)->name('entry.gpt-summary');
});

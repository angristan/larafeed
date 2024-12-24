<?php

use App\Actions\Feed\CreateNewFeed;
use App\Actions\Feed\RefreshFeedEntries;
use App\Actions\ImportOPML;
use App\Actions\ShowFeedReader;
use App\Actions\UpdateEntryInteractions;
use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('feeds.index');
    }

    return Inertia::render('Welcome');
});

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    // TODO: scoped route bindings
    Route::get('/feeds', ShowFeedReader::class)->name('feeds.index');
    // Route::post('/feed/{feed}/refresh', RefreshFeedEntries::class)->name('feed.refresh')->whereNumber('feed');
    Route::post('/feed', CreateNewFeed::class)->name('feed.store');

    Route::patch('/entry/{entry_id}', UpdateEntryInteractions::class)->name('entry.update');
    Route::get('/import', [ImportOPML::class, 'index'])->name('import.index');
    Route::post('/import', [ImportOPML::class, 'store'])->name('import.store');

});

require __DIR__.'/auth.php';

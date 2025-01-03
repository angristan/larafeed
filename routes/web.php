<?php

declare(strict_types=1);

use App\Actions\ExportOPML;
use App\Actions\Feed\CreateNewFeed;
use App\Actions\Feed\RefreshFeedEntries;
use App\Actions\ImportOPML;
use App\Actions\MarkEntriesAsRead;
use App\Actions\ShowFeedReader;
use App\Actions\UnsubscribeFromFeed;
use App\Actions\UpdateEntryInteractions;
use App\Features\Registration;
use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;
use Laravel\Pennant\Feature;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('feeds.index');
    }

    return Inertia::render('Welcome', [
        'canRegister' => Feature::active(Registration::class),
    ]);
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
    Route::delete('/feed/{feed_id}', UnsubscribeFromFeed::class)->name('feed.unsubscribe');
    Route::post('/feed/{feed_id}/refresh', RefreshFeedEntries::class)->name('feed.refresh');
    Route::post('/feed/{feed_id}/mark-read', MarkEntriesAsRead::class)->name('feed.mark-read');

    Route::get('/import', [ImportOPML::class, 'index'])->name('import.index');
    Route::post('/import', [ImportOPML::class, 'store'])->name('import.store');
    Route::get('/export', ExportOPML::class)->name('export.download');

});

require __DIR__.'/auth.php';

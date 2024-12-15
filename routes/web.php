<?php

use App\Actions\Entry\ShowEntryPage;
use App\Actions\Feed\RefreshFeedEntries;
use App\Actions\Feed\ShowFeedPage;
use App\Actions\Feed\ShowNewFeedPage;
use App\Http\Controllers\FeedController;
use App\Http\Controllers\ProfileController;
use Illuminate\Foundation\Application;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::get('/', function () {
    return Inertia::render('Welcome', [
        'canLogin' => Route::has('login'),
        'canRegister' => Route::has('register'),
        'laravelVersion' => Application::VERSION,
        'phpVersion' => PHP_VERSION,
    ]);
});

Route::get('/dashboard', function () {
    return Inertia::render('Dashboard');
})->middleware(['auth', 'verified'])->name('dashboard');

Route::middleware('auth')->group(function () {
    Route::get('/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('/profile', [ProfileController::class, 'update'])->name('profile.update');
    Route::delete('/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    // TODO: scoped route bindings
    Route::get('/feeds', [FeedController::class, 'index'])->name('feeds.index');
    Route::get('/feed/{feed}/entries', ShowFeedPage::class)->name('feed.entries')->whereNumber('feed');
    Route::get('/feed/{feed}/entry/{entry}', ShowEntryPage::class)->name('feed.entry')->whereNumber('feed')->whereNumber('entry');
    Route::post('/feed/{feed}/refresh', RefreshFeedEntries::class)->name('feed.refresh')->whereNumber('feed');
    Route::get('/feed/new', ShowNewFeedPage::class)->name('feed.create');
    Route::post('/feed', [FeedController::class, 'store'])->name('feed.store');
});

require __DIR__.'/auth.php';

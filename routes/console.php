<?php

declare(strict_types=1);

use App\Actions\Feed\RefreshFavicons;
use App\Actions\Feed\RefreshFeeds;
use Illuminate\Support\Facades\Schedule;

Schedule::command('telescope:prune')->daily();

Schedule::command(RefreshFeeds::class)->everyFiveMinutes();

// Refresh favicons for 1 feed every hour (gradually refreshes all feeds over time)
Schedule::command(RefreshFavicons::class, ['--limit=1'])->hourly();

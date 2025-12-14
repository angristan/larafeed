<?php

declare(strict_types=1);

namespace App\Actions\Favicon;

use App\Models\Feed;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Lorisleiva\Actions\Concerns\AsAction;

class AnalyzeExistingFavicons
{
    use AsAction;

    public string $commandSignature = 'feeds:analyze-favicon-brightness {--force : Re-analyze all favicons, even those already analyzed}';

    public string $commandDescription = 'Analyze brightness of existing favicons to determine if they are dark';

    public function asCommand(Command $command): void
    {
        $force = (bool) $command->option('force');

        $query = Feed::whereNotNull('favicon_url');

        if (! $force) {
            $query->whereNull('favicon_is_dark');
        }

        $feeds = $query->get();

        if ($feeds->isEmpty()) {
            $command->info('No favicons to analyze.');

            return;
        }

        Log::info('Starting favicon brightness analysis', [
            'total_feeds' => $feeds->count(),
            'force' => $force,
        ]);

        $results = [];
        $dark = 0;
        $light = 0;
        $failed = 0;

        $progressBar = $command->getOutput()->createProgressBar($feeds->count());
        $progressBar->start();

        foreach ($feeds as $feed) {
            $isDark = AnalyzeFaviconBrightness::run($feed->favicon_url);

            if ($isDark === null) {
                $failed++;
                $results[] = [
                    $feed->name,
                    $feed->favicon_url,
                    '<fg=yellow>failed</>',
                ];

                Log::warning('Failed to analyze favicon brightness', [
                    'feed_id' => $feed->id,
                    'feed_name' => $feed->name,
                    'favicon_url' => $feed->favicon_url,
                ]);
            } else {
                $feed->favicon_is_dark = $isDark;
                $feed->save();

                if ($isDark) {
                    $dark++;
                    $results[] = [
                        $feed->name,
                        $feed->favicon_url,
                        '<fg=red>dark</>',
                    ];
                } else {
                    $light++;
                    $results[] = [
                        $feed->name,
                        $feed->favicon_url,
                        '<fg=green>light</>',
                    ];
                }
            }

            $progressBar->advance();
        }

        $progressBar->finish();
        $command->newLine(2);

        $command->table(
            ['Feed', 'Favicon URL', 'Result'],
            $results
        );

        $command->newLine();
        $command->info("Summary: {$light} light, {$dark} dark, {$failed} failed");

        Log::info('Completed favicon brightness analysis', [
            'analyzed' => $light + $dark,
            'dark' => $dark,
            'light' => $light,
            'failed' => $failed,
        ]);
    }
}

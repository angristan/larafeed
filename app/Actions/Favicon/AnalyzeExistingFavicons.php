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

        $totalCount = $query->count();

        if ($totalCount === 0) {
            $command->info('No favicons to analyze.');

            return;
        }

        Log::info('Starting favicon brightness analysis', [
            'total_feeds' => $totalCount,
            'force' => $force,
        ]);

        $results = [];
        $dark = 0;
        $light = 0;
        $failed = 0;

        $progressBar = $command->getOutput()->createProgressBar($totalCount);
        $progressBar->start();

        // Use chunk() to process feeds in batches for memory efficiency
        $query->chunk(100, function ($feeds) use (&$results, &$dark, &$light, &$failed, $progressBar) {
            foreach ($feeds as $feed) {
                $isDark = AnalyzeFaviconBrightness::run($feed->favicon_url);

                if ($isDark === null) {
                    $failed++;
                    $results[] = [
                        $feed->name,
                        $feed->favicon_url,
                        '<fg=yellow>failed</>',
                    ];

                    // Set to true (conservative) to avoid retrying and ensure background is applied
                    $feed->favicon_is_dark = true;
                    $feed->save();

                    Log::warning('Failed to analyze favicon brightness, defaulting to dark', [
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
        });

        $progressBar->finish();
        $command->newLine(2);

        $command->table(
            ['Feed', 'Favicon URL', 'Result'],
            $results
        );

        $command->newLine();
        $command->info("Summary: {$light} light, {$dark} dark, {$failed} failed (defaulted to dark)");

        Log::info('Completed favicon brightness analysis', [
            'analyzed' => $light + $dark,
            'dark' => $dark,
            'light' => $light,
            'failed' => $failed,
        ]);
    }
}

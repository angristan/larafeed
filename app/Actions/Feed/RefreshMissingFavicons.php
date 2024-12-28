<?php

namespace App\Actions\Feed;

use App\Models\Feed;
use Illuminate\Console\Command;
use Lorisleiva\Actions\Concerns\AsAction;

class RefreshMissingFavicons
{
    use AsAction;

    public string $commandSignature = 'feeds:refresh-missing-favicons';

    public function handle(): void
    {
        Feed::whereNull('favicon_url')->each(
            fn (Feed $feed) => RefreshFavicon::dispatch($feed)
        );

    }

    public function asCommand(Command $command): void
    {
        $this->handle();
        $command->info('Done!');
    }
}

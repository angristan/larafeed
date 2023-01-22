<?php

namespace App\Actions\Feed;

use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowNewFeedPage
{
    use AsAction;

    /**
     * Show the new feed form page
     * This action is only meant to be used to return a view
     */
    public function handle(): \Inertia\Response
    {
        return Inertia::render('Feed/New');
    }
}

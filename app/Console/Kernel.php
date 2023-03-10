<?php

namespace App\Console;

use App\Actions\Feed\RefreshFeeds;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Console\Kernel as ConsoleKernel;

class Kernel extends ConsoleKernel
{
    /**
     * Define the application's command schedule.
     *
     * @param  \Illuminate\Console\Scheduling\Schedule  $schedule
     * @return void
     */
    protected function schedule(Schedule $schedule)
    {
        /**
         * Refresh Horizon metrics
         * https://laravel.com/docs/9.x/horizon#metrics
         */
        $schedule->command('horizon:snapshot')->everyFiveMinutes();

        /**
         * Refresh all feeds
         */
        $schedule->job(RefreshFeeds::makeJob())->hourly();
    }

    /**
     * Register the commands for the application.
     *
     * @return void
     */
    protected function commands()
    {
        $this->load(__DIR__.'/Commands');

        require base_path('routes/console.php');
    }
}

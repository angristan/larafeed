<?php

declare(strict_types=1);

namespace Database\Seeders;

use App\Models\Feed;
use App\Models\User;
use Illuminate\Database\Seeder;

class FeedSeeder extends Seeder
{
    /**
     * Run the database seeds.
     *
     * @return void
     */
    public function run()
    {
        Feed::factory(1)->hasEntries(5)->create();
        User::first()->feedsSubscriptions()->attach(Feed::first());
    }
}

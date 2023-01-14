<?php

namespace Database\Seeders;

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
        \App\Models\Feed::factory(1)->create();
    }
}

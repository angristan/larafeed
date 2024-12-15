<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends \Illuminate\Database\Eloquent\Factories\Factory<\App\Models\Feed>
 */
class FeedFactory extends Factory
{
    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => 'The Cloudflare Blog',
            'feed_url' => 'https://blog.cloudflare.com/rss/',
            'site_url' => 'https://blog.cloudflare.com/',
            'favicon_url' => 'https://blog.cloudflare.com/favicon.png',
        ];
    }
}

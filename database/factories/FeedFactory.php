<?php

declare(strict_types=1);

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
            'name' => $this->faker->company . ' Blog',
            'feed_url' => $this->faker->unique()->url . '/rss',
            'site_url' => $this->faker->url,
            'favicon_url' => $this->faker->imageUrl(32, 32),
        ];
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use willvincent\Feeds\Facades\FeedsFacade;

class Feed extends Model
{
    use HasFactory;

    public function entries()
    {
        return $this->hasMany(Entry::class);
    }

    public function refreshEntries()
    {
        $crawledFeed = FeedsFacade::make($this->url);
        collect($crawledFeed->get_items())->each(function ($item) {
            $this->entries()->updateOrCreate([
                'title' => $item->get_title(),
                'url' => $item->get_permalink(),
            ]);
        });
    }
}

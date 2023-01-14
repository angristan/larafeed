<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Entry extends Model
{
    use HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var array<string>
     */
    protected $fillable = [
        'title',
        'url',
        'author',
        'content',
        'published_at',
        'status',
        'starred',
    ];

    /**
     * Get the feed that owns the entry.
     */
    public function feed()
    {
        return $this->belongsTo(Feed::class);
    }
}

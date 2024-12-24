<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

/**
 * App\Models\Entry
 *
 * @property int $id
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property string $title
 * @property string $url
 * @property string|null $author
 * @property string $content
 * @property string $published_at
 * @property int $feed_id
 * @property-read \App\Models\Feed $feed
 * @property-read \App\Models\EntryInteraction|null $interaction
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\User> $users
 * @property-read int|null $users_count
 *
 * @method static \Database\Factories\EntryFactory factory($count = null, $state = [])
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereAuthor($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereContent($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereFeedId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry wherePublishedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereTitle($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|Entry whereUrl($value)
 *
 * @mixin \Eloquent
 */
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

    public function users()
    {
        return $this->belongsToMany(User::class, 'entry_interactions', 'entry_id', 'user_id')
            ->as('interaction')
            ->using(EntryInteraction::class)
            ->withTimestamps()
            ->withPivot(['read_at', 'starred_at', 'archived_at']);
    }

    private function updateOrCreateInteractionWithAttribute(User $user, string $column, mixed $value)
    {
        if ($this->users->contains($user)) {
            $this->users()->updateExistingPivot($user, [$column => $value]);
        } else {
            $this->users()->attach($user, [$column => $value]);
        }
    }

    public function markAsRead(User $user)
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'read_at', now());
    }

    public function markAsUnread(User $user)
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'read_at', null);
    }

    public function favorite(User $user)
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'starred_at', now());
    }

    public function unfavorite(User $user)
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'starred_at', null);
    }

    public function archive(User $user)
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'archived_at', now());
    }

    public function unarchive(User $user)
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'archived_at', null);
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use Database\Factories\EntryFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * App\Models\Entry
 *
 * @property int $id
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 * @property string $title
 * @property string $url
 * @property string|null $author
 * @property string|null $content
 * @property string $published_at
 * @property int $feed_id
 * @property-read \App\Models\Feed $feed
 * @property-read \App\Models\EntryInteraction|null $interaction
 * @property-read \Illuminate\Database\Eloquent\Collection<int, \App\Models\User> $users
 * @property-read int|null $users_count
 *
 * @method static \Database\Factories\EntryFactory factory($count = null, $state = [])
 * @method static Builder<static>|Entry forUser(\App\Models\User $user)
 * @method static Builder<static>|Entry newModelQuery()
 * @method static Builder<static>|Entry newQuery()
 * @method static Builder<static>|Entry query()
 * @method static Builder<static>|Entry whereAuthor($value)
 * @method static Builder<static>|Entry whereContent($value)
 * @method static Builder<static>|Entry whereCreatedAt($value)
 * @method static Builder<static>|Entry whereFeedId($value)
 * @method static Builder<static>|Entry whereId($value)
 * @method static Builder<static>|Entry wherePublishedAt($value)
 * @method static Builder<static>|Entry whereTitle($value)
 * @method static Builder<static>|Entry whereUpdatedAt($value)
 * @method static Builder<static>|Entry whereUrl($value)
 *
 * @mixin \Eloquent
 */
class Entry extends Model
{
    /** @use HasFactory<EntryFactory> */
    use HasFactory;

    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
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
     *
     * @return BelongsTo<Feed, $this>
     */
    public function feed(): BelongsTo
    {
        return $this->belongsTo(Feed::class);
    }

    /**
     * Scope entries to those from feeds the user is subscribed to.
     *
     * @param  Builder<Entry>  $query
     * @return Builder<Entry>
     */
    public function scopeForUser(Builder $query, User $user): Builder
    {
        return $query->whereIn('feed_id', $user->feeds()->select('feeds.id'));
    }

    /**
     * @return BelongsToMany<User, $this, EntryInteraction, 'interaction'>
     */
    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'entry_interactions', 'entry_id', 'user_id')
            ->as('interaction')
            ->using(EntryInteraction::class)
            ->withTimestamps()
            ->withPivot(['read_at', 'starred_at', 'archived_at']);
    }

    private function updateOrCreateInteractionWithAttribute(User $user, string $column, mixed $value): void
    {
        // The upsert() method:
        // - Performs a single atomic INSERT ... ON CONFLICT DO UPDATE query
        // - First array: the data to insert
        // - Second array: the columns that define uniqueness (composite key)
        // - Third array: columns to update if the record already exists
        EntryInteraction::upsert(
            [
                'user_id' => $user->id,
                'entry_id' => $this->id,
                $column => $value,
                'created_at' => now(),
                'updated_at' => now(),
            ],
            ['user_id', 'entry_id'],
            [$column, 'updated_at']
        );
    }

    public function markAsRead(User $user): void
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'read_at', now());
    }

    public function markAsUnread(User $user): void
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'read_at', null);
    }

    public function favorite(User $user): void
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'starred_at', now());
    }

    public function unfavorite(User $user): void
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'starred_at', null);
    }

    public function archive(User $user): void
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'archived_at', now());
    }

    public function unarchive(User $user): void
    {
        $this->updateOrCreateInteractionWithAttribute($user, 'archived_at', null);
    }
}

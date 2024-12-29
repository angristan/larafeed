<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * @property int $user_id
 * @property int $entry_id
 * @property string|null $read_at
 * @property string|null $starred_at
 * @property string|null $archived_at
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 *
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction query()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereArchivedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereCreatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereEntryId($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereReadAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereStarredAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereUpdatedAt($value)
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction whereUserId($value)
 *
 * @mixin \Eloquent
 */
class EntryInteraction extends Pivot
{
    protected $table = 'entry_interactions';
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|EntryInteraction query()
 *
 * @mixin \Eloquent
 */
class EntryInteraction extends Pivot {}

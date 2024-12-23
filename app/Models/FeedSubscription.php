<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\Pivot;

/**
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription newModelQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription newQuery()
 * @method static \Illuminate\Database\Eloquent\Builder<static>|FeedSubscription query()
 *
 * @mixin \Eloquent
 */
class FeedSubscription extends Pivot {}

<?php

declare(strict_types=1);

namespace App\Enums;

use BenSampo\Enum\Enum;

/**
 * @method static static Unread()
 * @method static static Read()
 */
final class EntryStatus extends Enum
{
    const Unread = 'unread';

    const Read = 'read';
}

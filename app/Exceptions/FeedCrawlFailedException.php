<?php

declare(strict_types=1);

namespace App\Exceptions;

use Exception;

class FeedCrawlFailedException extends Exception
{
    public function __construct(string $message = 'Feed could not be crawled', int $code = 0, ?Exception $previous = null)
    {
        parent::__construct($message, $code, $previous);
    }
}

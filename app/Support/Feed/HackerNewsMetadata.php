<?php

declare(strict_types=1);

namespace App\Support\Feed;

use App\Models\Feed;
use SimplePie\Item;

class HackerNewsMetadata
{
    public static function supports(Feed|string $feed): bool
    {
        $feedUrl = $feed instanceof Feed ? $feed->feed_url : $feed;

        $host = parse_url($feedUrl, PHP_URL_HOST);

        return is_string($host) && str_contains($host, 'hnrss.org');
    }

    /**
     * @return array{points: int|null, comments: int|null}
     */
    public static function extract(Item $item): array
    {
        $points = null;
        $comments = null;

        $pointsTag = $item->get_item_tags('http://hnrss.org/', 'points');
        if (is_array($pointsTag) && isset($pointsTag[0]['data'])) {
            $points = (int) $pointsTag[0]['data'];
        }

        $commentsTag = $item->get_item_tags('http://hnrss.org/', 'comments');
        if (is_array($commentsTag) && isset($commentsTag[0]['data'])) {
            $comments = (int) $commentsTag[0]['data'];
        }

        if ($points === null || $comments === null) {
            $description = $item->get_description() ?? $item->get_content() ?? '';
            $text = strip_tags($description);

            if ($points === null && preg_match('/Points:\s*(\d+)/i', $text, $matches)) {
                $points = (int) $matches[1];
            }

            if ($comments === null && preg_match('/#\s*Comments:\s*(\d+)/i', $text, $matches)) {
                $comments = (int) $matches[1];
            }
        }

        return [
            'points' => $points,
            'comments' => $comments,
        ];
    }
}


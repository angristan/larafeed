<?php

declare(strict_types=1);

namespace App\Actions\OPML;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Str;
use Lorisleiva\Actions\Concerns\AsAction;
use SimpleXMLElement;

class ExportOPML
{
    use AsAction;

    public function handle(): string
    {
        $user = Auth::user();
        if (! $user) {
            throw new \RuntimeException('Authenticated user required to export OPML.');
        }

        $xml = new SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"/>');

        // Add head section
        $head = $xml->addChild('head');
        $head->addChild('title', 'LaraFeed Export');
        $head->addChild('dateCreated', now()->format('D, d M Y H:i:s T'));

        // Add body section
        $body = $xml->addChild('body');

        $user->load([
            'subscriptionCategories' => fn ($query) => $query->orderBy('name'),
            'subscriptionCategories.feedsSubscriptions.feed',
        ]);

        foreach ($user->subscriptionCategories as $category) {
            $categoryOutline = $body->addChild('outline');
            $categoryOutline->addAttribute('text', $category->name);

            $subscriptions = $category->feedsSubscriptions
                ->sortBy(function ($subscription) {
                    $feedName = $subscription->custom_feed_name ?? $subscription->feed?->name ?? '';

                    return Str::lower($feedName);
                })
                ->values();

            foreach ($subscriptions as $subscription) {
                $feed = $subscription->feed;

                if (! $feed) {
                    continue;
                }

                $displayName = $subscription->custom_feed_name ?? $feed->name;

                $feedOutline = $categoryOutline->addChild('outline');
                $feedOutline->addAttribute('title', $displayName);
                $feedOutline->addAttribute('text', $displayName);

                if ($subscription->custom_feed_name) {
                    $feedOutline->addAttribute('custom_title', $subscription->custom_feed_name);
                }

                $feedOutline->addAttribute('xmlUrl', $feed->feed_url);
                $feedOutline->addAttribute('htmlUrl', $feed->site_url ?? $feed->feed_url);
                $feedOutline->addAttribute('type', 'rss');
            }
        }

        return $xml->asXML();
    }

    public function asController()
    {
        $xml = $this->handle();

        return response($xml, 200, [
            'Content-Type' => 'text/xml',
            'Content-Disposition' => 'attachment; filename="feeds.opml"',
        ]);
    }
}

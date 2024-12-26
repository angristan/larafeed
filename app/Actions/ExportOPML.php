<?php

namespace App\Actions;

use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;
use SimpleXMLElement;

class ExportOPML
{
    use AsAction;

    public function handle(): string
    {
        $xml = new SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"/>');

        // Add head section
        $head = $xml->addChild('head');
        $head->addChild('title', 'LaraFeed Export');
        $head->addChild('dateCreated', now()->format('D, d M Y H:i:s T'));

        // Add body section
        $body = $xml->addChild('body');
        $outline = $body->addChild('outline');
        // TODO: categories should be here
        $outline->addAttribute('text', 'Subscriptions');

        $feeds = Auth::user()->feeds()->get();

        foreach ($feeds as $feed) {
            $feedOutline = $outline->addChild('outline');
            $feedOutline->addAttribute('title', $feed->name);
            $feedOutline->addAttribute('text', $feed->name);
            $feedOutline->addAttribute('custom_title', $feed->subscription->custom_feed_name);
            $feedOutline->addAttribute('xmlUrl', $feed->feed_url);
            $feedOutline->addAttribute('htmlUrl', $feed->site_url ?? '');
            $feedOutline->addAttribute('type', 'rss');
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

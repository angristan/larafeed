<?php

namespace App\Actions\Entry;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Feed $feed, int $entryId)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Feed $feed, int $entryId)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Feed $feed, int $entryId)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Feed $feed, int $entryId)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Feed $feed, int $entryId)
 * @method static dispatchSync(\App\Models\Feed $feed, int $entryId)
 * @method static dispatchNow(\App\Models\Feed $feed, int $entryId)
 * @method static dispatchAfterResponse(\App\Models\Feed $feed, int $entryId)
 * @method static \Inertia\Response run(\App\Models\Feed $feed, int $entryId)
 */
class ShowEntryPage
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Entry $entry)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Entry $entry)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Entry $entry)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Entry $entry)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Entry $entry)
 * @method static dispatchSync(\App\Models\Entry $entry)
 * @method static dispatchNow(\App\Models\Entry $entry)
 * @method static dispatchAfterResponse(\App\Models\Entry $entry)
 * @method static string run(\App\Models\Entry $entry)
 */
class SummarizeEntryWithLLM
{
}
namespace App\Actions\Feed;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $feed_url)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $feed_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $feed_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $feed_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $feed_url)
 * @method static dispatchSync(string $feed_url)
 * @method static dispatchNow(string $feed_url)
 * @method static dispatchAfterResponse(string $feed_url)
 * @method static mixed run(string $feed_url)
 */
class CreateNewFeed
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Feed $feed)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Feed $feed)
 * @method static dispatchSync(\App\Models\Feed $feed)
 * @method static dispatchNow(\App\Models\Feed $feed)
 * @method static dispatchAfterResponse(\App\Models\Feed $feed)
 * @method static mixed run(\App\Models\Feed $feed)
 */
class RefreshFeedEntries
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob()
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob()
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch()
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean)
 * @method static dispatchSync()
 * @method static dispatchNow()
 * @method static dispatchAfterResponse()
 * @method static void run()
 */
class RefreshFeeds
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Feed $feed)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Feed $feed)
 * @method static dispatchSync(\App\Models\Feed $feed)
 * @method static dispatchNow(\App\Models\Feed $feed)
 * @method static dispatchAfterResponse(\App\Models\Feed $feed)
 * @method static \Inertia\Response run(\App\Models\Feed $feed)
 */
class ShowFeedPage
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob()
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob()
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch()
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean)
 * @method static dispatchSync()
 * @method static dispatchNow()
 * @method static dispatchAfterResponse()
 * @method static \Inertia\Response run()
 */
class ShowNewFeedPage
{
}
namespace App\Actions;

/**
 */
class ImportOPML
{
}
namespace Lorisleiva\Actions\Concerns;

/**
 * @method void asController()
 */
trait AsController
{
}
/**
 * @method void asListener()
 */
trait AsListener
{
}
/**
 * @method void asJob()
 */
trait AsJob
{
}
/**
 * @method void asCommand(\Illuminate\Console\Command $command)
 */
trait AsCommand
{
}
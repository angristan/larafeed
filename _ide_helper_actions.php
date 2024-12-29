<?php

namespace App\Actions\Auth;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Events\LoginFailed $event)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Events\LoginFailed $event)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Events\LoginFailed $event)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Events\LoginFailed $event)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Events\LoginFailed $event)
 * @method static dispatchSync(\App\Events\LoginFailed $event)
 * @method static dispatchNow(\App\Events\LoginFailed $event)
 * @method static dispatchAfterResponse(\App\Events\LoginFailed $event)
 * @method static mixed run(\App\Events\LoginFailed $event)
 */
class NotifyLoginFailureOnTelegram
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user)
 * @method static dispatchSync(\App\Models\User $user)
 * @method static dispatchNow(\App\Models\User $user)
 * @method static dispatchAfterResponse(\App\Models\User $user)
 * @method static mixed run(\App\Models\User $user)
 */
class NotifyUserRegistrationOnTelegram
{
}
namespace App\Actions\Entry;

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
namespace App\Actions;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob()
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob()
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch()
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean)
 * @method static dispatchSync()
 * @method static dispatchNow()
 * @method static dispatchAfterResponse()
 * @method static string run()
 */
class ExportOPML
{
}
/**
 */
class ImportOPML
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\Illuminate\Http\Request $request)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\Illuminate\Http\Request $request)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\Illuminate\Http\Request $request)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \Illuminate\Http\Request $request)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \Illuminate\Http\Request $request)
 * @method static dispatchSync(\Illuminate\Http\Request $request)
 * @method static dispatchNow(\Illuminate\Http\Request $request)
 * @method static dispatchAfterResponse(\Illuminate\Http\Request $request)
 * @method static \Inertia\Response run(\Illuminate\Http\Request $request)
 */
class ShowFeedReader
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user, int $feedId)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user, int $feedId)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user, int $feedId)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user, int $feedId)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user, int $feedId)
 * @method static dispatchSync(\App\Models\User $user, int $feedId)
 * @method static dispatchNow(\App\Models\User $user, int $feedId)
 * @method static dispatchAfterResponse(\App\Models\User $user, int $feedId)
 * @method static void run(\App\Models\User $user, int $feedId)
 */
class UnsubscribeFromFeed
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \Illuminate\Http\Request $request, string $entry_id)
 * @method static dispatchSync(\Illuminate\Http\Request $request, string $entry_id)
 * @method static dispatchNow(\Illuminate\Http\Request $request, string $entry_id)
 * @method static dispatchAfterResponse(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Http\JsonResponse run(\Illuminate\Http\Request $request, string $entry_id)
 */
class UpdateEntryInteractions
{
}
namespace App\Actions\Feed;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static dispatchSync(string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static dispatchNow(string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static dispatchAfterResponse(string $requested_feed_url, ?\App\Models\User $attachedUser)
 * @method static mixed run(string $requested_feed_url, ?\App\Models\User $attachedUser)
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
 * @method static void run(\App\Models\Feed $feed)
 */
class RefreshFavicon
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
class RefreshMissingFavicons
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
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
 * @method static void run(\App\Events\LoginFailed $event)
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
 * @method static void run(\App\Models\User $user)
 */
class NotifyUserRegistrationOnTelegram
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $name, string $email, string $password)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $name, string $email, string $password)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $name, string $email, string $password)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $name, string $email, string $password)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $name, string $email, string $password)
 * @method static dispatchSync(string $name, string $email, string $password)
 * @method static dispatchNow(string $name, string $email, string $password)
 * @method static dispatchAfterResponse(string $name, string $email, string $password)
 * @method static \App\Models\User run(string $name, string $email, string $password)
 */
class RegisterUser
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $email, string $password, string $passwordConfirmation, string $token)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $email, string $password, string $passwordConfirmation, string $token)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $email, string $password, string $passwordConfirmation, string $token)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $email, string $password, string $passwordConfirmation, string $token)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $email, string $password, string $passwordConfirmation, string $token)
 * @method static dispatchSync(string $email, string $password, string $passwordConfirmation, string $token)
 * @method static dispatchNow(string $email, string $password, string $passwordConfirmation, string $token)
 * @method static dispatchAfterResponse(string $email, string $password, string $passwordConfirmation, string $token)
 * @method static string run(string $email, string $password, string $passwordConfirmation, string $token)
 */
class ResetPassword
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user, string $password)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user, string $password)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user, string $password)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user, string $password)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user, string $password)
 * @method static dispatchSync(\App\Models\User $user, string $password)
 * @method static dispatchNow(\App\Models\User $user, string $password)
 * @method static dispatchAfterResponse(\App\Models\User $user, string $password)
 * @method static void run(\App\Models\User $user, string $password)
 */
class UpdatePassword
{
}
namespace App\Actions\Category;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user, string $name)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user, string $name)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user, string $name)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user, string $name)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user, string $name)
 * @method static dispatchSync(\App\Models\User $user, string $name)
 * @method static dispatchNow(\App\Models\User $user, string $name)
 * @method static dispatchAfterResponse(\App\Models\User $user, string $name)
 * @method static \App\Models\SubscriptionCategory run(\App\Models\User $user, string $name)
 */
class CreateCategory
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\Request $request, string $category_id)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\Request $request, string $category_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\Request $request, string $category_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \Request $request, string $category_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \Request $request, string $category_id)
 * @method static dispatchSync(\Request $request, string $category_id)
 * @method static dispatchNow(\Request $request, string $category_id)
 * @method static dispatchAfterResponse(\Request $request, string $category_id)
 * @method static \Illuminate\Http\RedirectResponse run(\Request $request, string $category_id)
 */
class DeleteCategory
{
}
namespace App\Actions\Entry;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static dispatchSync(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static dispatchNow(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static dispatchAfterResponse(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 * @method static void run(\App\Models\FeedSubscription $subscription, ?\Illuminate\Support\Collection $entries = null)
 */
class ApplySubscriptionFilters
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Entry $entry, ?array $filterRules)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Entry $entry, ?array $filterRules)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Entry $entry, ?array $filterRules)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Entry $entry, ?array $filterRules)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Entry $entry, ?array $filterRules)
 * @method static dispatchSync(\App\Models\Entry $entry, ?array $filterRules)
 * @method static dispatchNow(\App\Models\Entry $entry, ?array $filterRules)
 * @method static dispatchAfterResponse(\App\Models\Entry $entry, ?array $filterRules)
 * @method static bool run(\App\Models\Entry $entry, ?array $filterRules)
 */
class EvaluateEntryFilter
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $content)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $content)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $content)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $content)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $content)
 * @method static dispatchSync(string $content)
 * @method static dispatchNow(string $content)
 * @method static dispatchAfterResponse(string $content)
 * @method static string run(string $content)
 */
class ProxifyImagesInHTML
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
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \Illuminate\Http\Request $request, string $entry_id)
 * @method static dispatchSync(\Illuminate\Http\Request $request, string $entry_id)
 * @method static dispatchNow(\Illuminate\Http\Request $request, string $entry_id)
 * @method static dispatchAfterResponse(\Illuminate\Http\Request $request, string $entry_id)
 * @method static \Illuminate\Http\RedirectResponse run(\Illuminate\Http\Request $request, string $entry_id)
 */
class UpdateEntryInteractions
{
}
namespace App\Actions\Favicon;

/**
 */
class AnalyzeExistingFavicons
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $favicon_url)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $favicon_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $favicon_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $favicon_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $favicon_url)
 * @method static dispatchSync(string $favicon_url)
 * @method static dispatchNow(string $favicon_url)
 * @method static dispatchAfterResponse(string $favicon_url)
 * @method static ?bool run(string $favicon_url)
 */
class AnalyzeFaviconBrightness
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(?string $favicon_url)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(?string $favicon_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(?string $favicon_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, ?string $favicon_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, ?string $favicon_url)
 * @method static dispatchSync(?string $favicon_url)
 * @method static dispatchNow(?string $favicon_url)
 * @method static dispatchAfterResponse(?string $favicon_url)
 * @method static string run(?string $favicon_url)
 */
class BuildProxifiedFaviconURL
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $original_site_url)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $original_site_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $original_site_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $original_site_url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $original_site_url)
 * @method static dispatchSync(string $original_site_url)
 * @method static dispatchNow(string $original_site_url)
 * @method static dispatchAfterResponse(string $original_site_url)
 * @method static ?string run(string $original_site_url)
 */
class GetFaviconURL
{
}
namespace App\Actions\Feed;

/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static dispatchSync(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static dispatchNow(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static dispatchAfterResponse(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 * @method static \Illuminate\Http\RedirectResponse run(string $requested_feed_url, ?\App\Models\User $attachedUser, ?int $category_id, bool $force = false, ?string $fallback_name = null)
 */
class CreateNewFeed
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(string $url)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(string $url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(string $url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, string $url)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, string $url)
 * @method static dispatchSync(string $url)
 * @method static dispatchNow(string $url)
 * @method static dispatchAfterResponse(string $url)
 * @method static array run(string $url)
 */
class FetchFeed
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static dispatchSync(\App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static dispatchNow(\App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static dispatchAfterResponse(\App\Models\Feed $feed, array $items, ?int $limit = null)
 * @method static \Illuminate\Support\Collection run(\App\Models\Feed $feed, array $items, ?int $limit = null)
 */
class IngestFeedEntries
{
}
/**
 */
class MarkEntriesAsRead
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static dispatchSync(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static dispatchNow(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static dispatchAfterResponse(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 * @method static void run(\App\Models\Feed $feed, \Illuminate\Support\Carbon $timestamp, bool $success, int $entriesCreated, ?string $error = null)
 */
class RecordFeedRefresh
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
class RefreshAllFavicons
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
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(int $limit = 1)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(int $limit = 1)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(int $limit = 1)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, int $limit = 1)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, int $limit = 1)
 * @method static dispatchSync(int $limit = 1)
 * @method static dispatchNow(int $limit = 1)
 * @method static dispatchAfterResponse(int $limit = 1)
 * @method static void run(int $limit = 1)
 */
class RefreshFavicons
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
class RefreshFeed
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
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(int $days = 30)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(int $days = 30)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(int $days = 30)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, int $days = 30)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, int $days = 30)
 * @method static dispatchSync(int $days = 30)
 * @method static dispatchNow(int $days = 30)
 * @method static dispatchAfterResponse(int $days = 30)
 * @method static void run(int $days = 30)
 */
class RefreshOutdatedFavicons
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user, \App\Models\Feed $feed)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user, \App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user, \App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user, \App\Models\Feed $feed)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user, \App\Models\Feed $feed)
 * @method static dispatchSync(\App\Models\User $user, \App\Models\Feed $feed)
 * @method static dispatchNow(\App\Models\User $user, \App\Models\Feed $feed)
 * @method static dispatchAfterResponse(\App\Models\User $user, \App\Models\Feed $feed)
 * @method static void run(\App\Models\User $user, \App\Models\Feed $feed)
 */
class UnsubscribeFromFeed
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\Illuminate\Http\Request $request, string $feed_id)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\Illuminate\Http\Request $request, string $feed_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\Illuminate\Http\Request $request, string $feed_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \Illuminate\Http\Request $request, string $feed_id)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \Illuminate\Http\Request $request, string $feed_id)
 * @method static dispatchSync(\Illuminate\Http\Request $request, string $feed_id)
 * @method static dispatchNow(\Illuminate\Http\Request $request, string $feed_id)
 * @method static dispatchAfterResponse(\Illuminate\Http\Request $request, string $feed_id)
 * @method static \Illuminate\Http\RedirectResponse run(\Illuminate\Http\Request $request, string $feed_id)
 */
class UpdateFeed
{
}
namespace App\Actions\FeverAPI;

/**
 */
class BaseFeverAction
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
 * @method static array run()
 */
class GetFeeds
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
 * @method static array run()
 */
class GetGroups
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
 * @method static array run(\Illuminate\Http\Request $request)
 */
class GetItems
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
 * @method static array run()
 */
class GetSavedItemIds
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
 * @method static array run()
 */
class GetUnreadItemIds
{
}
/**
 */
class HandleRequest
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
 * @method static array run(\Illuminate\Http\Request $request)
 */
class UpdateItem
{
}
namespace App\Actions\GoogleReaderAPI;

/**
 */
class ClientLogin
{
}
/**
 */
class EditTag
{
}
/**
 */
class GetStreamContents
{
}
/**
 */
class GetStreamItemIds
{
}
/**
 */
class GetSubscriptionList
{
}
/**
 */
class GetToken
{
}
/**
 */
class GetUserInfo
{
}
namespace App\Actions\OPML;

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
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user, string $opmlContent)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user, string $opmlContent)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user, string $opmlContent)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user, string $opmlContent)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user, string $opmlContent)
 * @method static dispatchSync(\App\Models\User $user, string $opmlContent)
 * @method static dispatchNow(\App\Models\User $user, string $opmlContent)
 * @method static dispatchAfterResponse(\App\Models\User $user, string $opmlContent)
 * @method static void run(\App\Models\User $user, string $opmlContent)
 */
class ImportOPML
{
}
namespace App\Actions;

/**
 */
class ShowCharts
{
}
/**
 */
class ShowFeedReader
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
class ShowSubscriptions
{
}
namespace App\Actions\User;

/**
 */
class DeleteAccount
{
}
/**
 */
class ShowSettings
{
}
/**
 * @method static \Lorisleiva\Actions\Decorators\JobDecorator|\Lorisleiva\Actions\Decorators\UniqueJobDecorator makeJob(\App\Models\User $user, array $attributes)
 * @method static \Lorisleiva\Actions\Decorators\UniqueJobDecorator makeUniqueJob(\App\Models\User $user, array $attributes)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch dispatch(\App\Models\User $user, array $attributes)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchIf(bool $boolean, \App\Models\User $user, array $attributes)
 * @method static \Illuminate\Foundation\Bus\PendingDispatch|\Illuminate\Support\Fluent dispatchUnless(bool $boolean, \App\Models\User $user, array $attributes)
 * @method static dispatchSync(\App\Models\User $user, array $attributes)
 * @method static dispatchNow(\App\Models\User $user, array $attributes)
 * @method static dispatchAfterResponse(\App\Models\User $user, array $attributes)
 * @method static void run(\App\Models\User $user, array $attributes)
 */
class UpdateProfile
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
 * @method static \Illuminate\Http\RedirectResponse run(\Illuminate\Http\Request $request)
 */
class WipeAccount
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
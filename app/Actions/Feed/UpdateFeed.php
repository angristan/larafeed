<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Models\Feed;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Lorisleiva\Actions\Concerns\AsAction;

class UpdateFeed
{
    use AsAction;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'category_id' => ['exists:subscription_categories,id'],
            'name' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function handle(Request $request, string $feed_id): \Illuminate\Http\RedirectResponse
    {
        $feed = Feed::forUser(Auth::user())->find($feed_id);

        if (! $feed) {
            return redirect()->back()->withErrors('Subscription not found');
        }

        $subscription = FeedSubscription::where('feed_id', $feed_id)->where('user_id', Auth::id())->first();

        // Validate category before transaction to ensure rollback on failure
        if ($request->has('category_id')) {
            $category = SubscriptionCategory::forUser(Auth::user())->find($request->input('category_id'));

            if (! $category) {
                return redirect()->back()->withErrors('Category not found');
            }
        }

        DB::transaction(function () use ($request, $subscription) {
            if ($request->has('name')) {
                $subscription->custom_feed_name = $request->input('name') === '' ? null : $request->input('name');
                $subscription->save();
            }

            if ($request->has('category_id')) {
                $subscription->category_id = $request->input('category_id');
                $subscription->save();
            }
        });

        return redirect()->back();
    }
}

<?php

declare(strict_types=1);

namespace App\Actions\Feed;

use App\Actions\Entry\ApplySubscriptionFilters;
use App\Models\Feed;
use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use App\Rules\SafeFilterPattern;
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
            'filter_rules' => ['nullable', 'array'],
            'filter_rules.exclude_title' => ['nullable', 'array'],
            'filter_rules.exclude_title.*' => ['string', 'max:255', new SafeFilterPattern],
            'filter_rules.exclude_content' => ['nullable', 'array'],
            'filter_rules.exclude_content.*' => ['string', 'max:255', new SafeFilterPattern],
            'filter_rules.exclude_author' => ['nullable', 'array'],
            'filter_rules.exclude_author.*' => ['string', 'max:255', new SafeFilterPattern],
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

            if ($request->has('filter_rules')) {
                $newFilterRules = $request->input('filter_rules');

                // Clean up empty arrays in filter rules
                if (is_array($newFilterRules)) {
                    $newFilterRules = array_filter($newFilterRules, fn ($rules) => ! empty($rules));
                    if (empty($newFilterRules)) {
                        $newFilterRules = null;
                    }
                }

                $filterRulesChanged = json_encode($subscription->filter_rules) !== json_encode($newFilterRules);
                $subscription->filter_rules = $newFilterRules;
                $subscription->save();

                // Re-evaluate filters if rules changed (inside transaction for atomicity)
                if ($filterRulesChanged) {
                    ApplySubscriptionFilters::run($subscription);
                }
            }
        });

        return redirect()->back();
    }
}

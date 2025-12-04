<?php

declare(strict_types=1);

namespace App\Actions\Category;

use App\Models\FeedSubscription;
use App\Models\SubscriptionCategory;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Auth;
use Lorisleiva\Actions\Concerns\AsAction;

class DeleteCategory
{
    use AsAction;

    public function handle(\Request $request, string $category_id): RedirectResponse
    {
        $category = SubscriptionCategory::where('id', $category_id)
            ->where('user_id', Auth::id())
            ->first();

        if (! $category) {
            return redirect()->back()->withErrors([
                'Category not found',
            ]);
        }

        $subscriptionsForCategory = FeedSubscription::where('category_id', $category_id)
            ->count();

        if ($subscriptionsForCategory > 0) {
            return redirect()->back()->withErrors([
                'Cannot delete category with subscriptions',
            ]);
        }

        $category->delete();

        return redirect()->back();
    }
}

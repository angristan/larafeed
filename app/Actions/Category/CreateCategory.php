<?php

declare(strict_types=1);

namespace App\Actions\Category;

use App\Models\SubscriptionCategory;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use Lorisleiva\Actions\Concerns\AsAction;

class CreateCategory
{
    use AsAction;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'categoryName' => [
                'required',
                'max:20',
                Rule::unique('subscription_categories', 'name')
                    ->where(fn ($query) => $query->where('user_id', Auth::id())),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function getValidationMessages(): array
    {
        return [
            'categoryName.required' => 'Please enter a category name',
            'categoryName.max' => 'Please enter a category name that is less than 20 characters',
            'categoryName.unique' => 'You already have a category with that name',
        ];
    }

    public function asController(Request $request): RedirectResponse
    {
        $this->handle(Auth::user(), $request->input('categoryName'));

        return redirect()->route('feeds.index');
    }

    public function handle(User $user, string $name): SubscriptionCategory
    {
        return SubscriptionCategory::query()->create([
            'user_id' => $user->id,
            'name' => $name,
        ]);
    }
}

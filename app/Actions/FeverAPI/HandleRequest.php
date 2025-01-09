<?php

declare(strict_types=1);

namespace App\Actions\FeverAPI;

use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Lorisleiva\Actions\Concerns\AsAction;

class HandleRequest
{
    use AsAction;

    public function rules()
    {
        return [
            'groups' => ['sometimes'],
            'feeds' => ['sometimes'],
            'items' => ['sometimes'],
            'unread_item_ids' => ['sometimes'],
            'saved_item_ids' => ['sometimes'],
            'mark' => ['sometimes'],
            'id' => ['sometimes', 'integer'],
            'as' => ['sometimes', Rule::in(['save', 'unsaved', 'read', 'unread'])],
            'since_id' => ['sometimes', 'integer'],
            'max_id' => ['sometimes', 'integer'],
            'with_ids' => ['sometimes', 'string'],
        ];
    }

    public function asController(Request $request)
    {
        if ($request->has('groups')) {
            return app(GetGroups::class)->handle();
        }

        if ($request->has('feeds')) {
            return app(GetFeeds::class)->handle();
        }

        if ($request->has('items')) {
            return app(GetItems::class)->handle($request);
        }

        if ($request->has('unread_item_ids')) {
            return app(GetUnreadItemIds::class)->handle();
        }

        if ($request->has('saved_item_ids')) {
            return app(GetSavedItemIds::class)->handle();
        }

        if ($request->has('mark')) {
            return app(UpdateItem::class)->handle($request);
        }

        return response()->json((new BaseFeverAction)->getBaseResponse());
    }
}

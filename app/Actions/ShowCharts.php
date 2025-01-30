<?php

declare(strict_types=1);

namespace App\Actions;

use App\Models\Entry;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Lorisleiva\Actions\Concerns\AsAction;

class ShowCharts
{
    use AsAction;

    public function asController(Request $request): \Inertia\Response
    {
        $hourlyData = Entry::query()
            ->join('feed_subscriptions', function ($join) {
                $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->select([
                DB::raw('EXTRACT(HOUR FROM published_at) as hour'),
                DB::raw('COUNT(*) as value'),
            ])
            ->groupBy('hour')
            ->orderBy('hour')
            ->get()
            ->map(function ($row) {
                return [
                    'hour' => sprintf('%02d:00', $row['hour']),
                    'index' => 1,
                    'value' => (int) $row['value'],
                ];
            });

        $dailyReads = Entry::query()
            ->join('feed_subscriptions', function ($join) {
                $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', Auth::id());
            })
            ->join('entry_interactions', function ($join) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', Auth::id());
            })
            ->whereNotNull('entry_interactions.read_at')
            ->select([
                DB::raw('DATE(entry_interactions.read_at) as date'),
                DB::raw('COUNT(*) as count'),
            ])
            ->groupBy('date')
            ->orderBy('date', 'desc')
            ->limit(30)
            ->get()
            ->map(function ($row) {
                return [
                    'date' => $row['date'],
                    'reads' => (int) $row['count'],
                ];
            });

        return Inertia::render('Charts', [
            'data' => $hourlyData,
            'dailyReads' => $dailyReads,
        ]);
    }
}

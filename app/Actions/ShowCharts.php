<?php

declare(strict_types=1);

namespace App\Actions;

use App\Models\Entry;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
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
        $userId = Auth::id();

        $feeds = DB::table('feed_subscriptions')
            ->join('feeds', 'feed_subscriptions.feed_id', '=', 'feeds.id')
            ->where('feed_subscriptions.user_id', $userId)
            ->orderBy(DB::raw('COALESCE(feed_subscriptions.custom_feed_name, feeds.name)'))
            ->get([
                'feed_subscriptions.feed_id as id',
                DB::raw('COALESCE(feed_subscriptions.custom_feed_name, feeds.name) as name'),
            ]);

        $categories = DB::table('subscription_categories')
            ->where('subscription_categories.user_id', $userId)
            ->orderBy('subscription_categories.name')
            ->get([
                'subscription_categories.id as id',
                'subscription_categories.name as name',
            ]);

        $rawFeedId = $request->input('feedId');
        $feedId = $rawFeedId !== null && $rawFeedId !== '' ? (int) $rawFeedId : null;
        if ($feedId !== null && ! $feeds->pluck('id')->contains($feedId)) {
            $feedId = null;
        }

        $rawCategoryId = $request->input('categoryId');
        $categoryId = $rawCategoryId !== null && $rawCategoryId !== '' ? (int) $rawCategoryId : null;
        if ($categoryId !== null && ! $categories->pluck('id')->contains($categoryId)) {
            $categoryId = null;
        }

        $group = $request->input('group', 'all');
        if (! in_array($group, ['all', 'feed', 'category'], true)) {
            $group = 'all';
        }

        $range = $request->input('range', '365');
        $endDate = Carbon::parse($request->input('endDate', Carbon::now()->toDateString()))->endOfDay();

        if ($range === 'custom') {
            $startDateInput = $request->input('startDate', $endDate->copy()->subDays(364)->toDateString());
            $startDate = Carbon::parse($startDateInput)->startOfDay();
        } else {
            $allowedRanges = [30, 90, 365];
            $days = (int) $range;
            if (! in_array($days, $allowedRanges, true)) {
                $days = 365;
            }

            $range = (string) $days;
            $startDate = $endDate->copy()->subDays($days - 1)->startOfDay();
        }

        if ($startDate->greaterThan($endDate)) {
            $startDate = $endDate->copy()->startOfDay();
        }

        $subscribedEntriesQuery = Entry::query()
            ->join('feed_subscriptions', function ($join) use ($userId) {
                $join->on('entries.feed_id', '=', 'feed_subscriptions.feed_id')
                    ->where('feed_subscriptions.user_id', '=', $userId);
            })
            ->when($group === 'feed' && $feedId !== null, function ($query) use ($feedId) {
                $query->where('entries.feed_id', '=', $feedId);
            })
            ->when($group === 'category' && $categoryId !== null, function ($query) use ($categoryId) {
                $query->where('feed_subscriptions.category_id', '=', $categoryId);
            });

        $dailyEntries = (clone $subscribedEntriesQuery)
            ->whereBetween('entries.published_at', [$startDate, $endDate])
            ->select([
                DB::raw('DATE(entries.published_at) as date'),
                DB::raw('COUNT(*) as count'),
            ])
            ->groupBy('date')
            ->orderBy('date')
            ->get()
            ->map(function ($row) {
                return [
                    'date' => $row['date'],
                    'entries' => (int) $row['count'],
                ];
            })
            ->values();

        $interactionsQuery = (clone $subscribedEntriesQuery)
            ->join('entry_interactions', function ($join) use ($userId) {
                $join->on('entries.id', '=', 'entry_interactions.entry_id')
                    ->where('entry_interactions.user_id', '=', $userId);
            });

        $dailyReads = (clone $interactionsQuery)
            ->whereNotNull('entry_interactions.read_at')
            ->whereBetween('entry_interactions.read_at', [$startDate, $endDate])
            ->select([
                DB::raw('DATE(entry_interactions.read_at) as date'),
                DB::raw('COUNT(*) as count'),
            ])
            ->groupBy('date')
            ->orderBy('date')
            ->get()
            ->map(function ($row) {
                return [
                    'date' => $row['date'],
                    'reads' => (int) $row['count'],
                ];
            })
            ->values();

        $dailySaved = (clone $interactionsQuery)
            ->whereNotNull('entry_interactions.starred_at')
            ->whereBetween('entry_interactions.starred_at', [$startDate, $endDate])
            ->select([
                DB::raw('DATE(entry_interactions.starred_at) as date'),
                DB::raw('COUNT(*) as count'),
            ])
            ->groupBy('date')
            ->orderBy('date')
            ->get()
            ->map(function ($row) {
                return [
                    'date' => $row['date'],
                    'saved' => (int) $row['count'],
                ];
            })
            ->values();

        $entriesPerDay = $dailyEntries->pluck('entries', 'date');
        $readsPerDay = $dailyReads->pluck('reads', 'date');

        $backlogTrend = [];
        $readThrough = [];
        $runningBacklog = 0;

        $period = CarbonPeriod::create(
            $startDate->copy()->startOfDay(),
            '1 day',
            $endDate->copy()->startOfDay()
        );

        foreach ($period as $date) {
            $dateKey = $date->format('Y-m-d');
            $entries = (int) $entriesPerDay->get($dateKey, 0);
            $reads = (int) $readsPerDay->get($dateKey, 0);

            $runningBacklog += $entries - $reads;

            $backlogTrend[] = [
                'date' => $dateKey,
                'value' => $runningBacklog,
            ];

            $readThrough[] = [
                'date' => $dateKey,
                'value' => $entries > 0 ? round(($reads / $entries) * 100, 2) : null,
            ];
        }

        $totalEntries = $dailyEntries->sum('entries');
        $totalReads = $dailyReads->sum('reads');
        $totalSaved = $dailySaved->sum('saved');

        $summary = [
            'totalEntries' => $totalEntries,
            'totalReads' => $totalReads,
            'totalSaved' => $totalSaved,
            'readThroughRate' => $totalEntries > 0 ? round(($totalReads / $totalEntries) * 100, 2) : 0,
            'currentBacklog' => $runningBacklog,
        ];

        $filters = [
            'range' => $range,
            'group' => $group,
            'feedId' => $feedId,
            'categoryId' => $categoryId,
            'startDate' => $startDate->toDateString(),
            'endDate' => $endDate->toDateString(),
        ];

        return Inertia::render('Charts', [
            'dailyReads' => $dailyReads,
            'dailyEntries' => $dailyEntries,
            'dailySaved' => $dailySaved,
            'backlogTrend' => $backlogTrend,
            'readThrough' => $readThrough,
            'summary' => $summary,
            'filters' => $filters,
            'feeds' => $feeds,
            'categories' => $categories,
        ]);
    }
}

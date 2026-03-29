package service

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChartsService struct {
	q    db.Querier
	pool *pgxpool.Pool
}

func NewChartsService(q db.Querier, pool *pgxpool.Pool) *ChartsService {
	return &ChartsService{q: q, pool: pool}
}

type DailyCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

type DailyBacklog struct {
	Date    string
	Backlog int
}

type DailyReadThrough struct {
	Date       string
	Percentage *float64
}

type DailyRefresh struct {
	Date           string   `json:"date"`
	Successes      int      `json:"successes"`
	Failures       int      `json:"failures"`
	TotalAttempts  int      `json:"totalAttempts"`
	SuccessRate    *float64 `json:"successRate"`
	EntriesCreated int      `json:"entriesCreated"`
}

type ChartsQuery struct {
	RangeDays    int
	FeedIDFilter *int64
}

type ChartsData struct {
	DailyEntries   []DailyCount
	DailyReads     []DailyCount
	DailySaved     []DailyCount
	BacklogTrend   []DailyBacklog
	ReadThrough    []DailyReadThrough
	DailyRefreshes []DailyRefresh
	RefreshStats   db.GetRefreshStatsRow
	Feeds          []db.ListSubscriptionsForUserRow
	Categories     []db.SubscriptionCategory
}

// GetChartsData fetches all analytics data for the charts page.
func (s *ChartsService) GetChartsData(ctx context.Context, userID int64, params ChartsQuery) (ChartsData, error) {
	since := time.Now().AddDate(0, 0, -params.RangeDays)

	dailyEntries := s.queryDailyCounts(ctx, userID, params.FeedIDFilter, since, `
		SELECT DATE(e.published_at) as d, COUNT(*) as c
		FROM entries e
		JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
		LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = $1
		WHERE e.published_at >= $2 AND (ei.filtered_at IS NULL)
			AND ($3::bigint IS NULL OR e.feed_id = $3)
		GROUP BY d ORDER BY d`)

	dailyReads := s.queryDailyCounts(ctx, userID, params.FeedIDFilter, since, `
		SELECT DATE(ei.read_at) as d, COUNT(*) as c
		FROM entry_interactions ei
		JOIN entries e ON ei.entry_id = e.id
		JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
		WHERE ei.read_at >= $2 AND ei.user_id = $1
			AND ($3::bigint IS NULL OR e.feed_id = $3)
		GROUP BY d ORDER BY d`)

	dailySaved := s.queryDailyCounts(ctx, userID, params.FeedIDFilter, since, `
		SELECT DATE(ei.starred_at) as d, COUNT(*) as c
		FROM entry_interactions ei
		JOIN entries e ON ei.entry_id = e.id
		JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
		WHERE ei.starred_at >= $2 AND ei.user_id = $1
			AND ($3::bigint IS NULL OR e.feed_id = $3)
		GROUP BY d ORDER BY d`)

	backlogTrend := ComputeBacklogTrend(dailyEntries, dailyReads, since, params.RangeDays)
	readThrough := ComputeReadThrough(dailyEntries, dailyReads, since, params.RangeDays)
	dailyRefreshes := s.queryDailyRefreshes(ctx, userID, params.FeedIDFilter, since, params.RangeDays)

	stats, err := s.q.GetRefreshStats(ctx, db.GetRefreshStatsParams{UserID: userID, RefreshedAt: since})
	if err != nil {
		return ChartsData{}, fmt.Errorf("get refresh stats: %w", err)
	}
	feeds, err := s.q.ListSubscriptionsForUser(ctx, userID)
	if err != nil {
		return ChartsData{}, fmt.Errorf("list subscriptions: %w", err)
	}
	cats, err := s.q.ListCategoriesForUser(ctx, userID)
	if err != nil {
		return ChartsData{}, fmt.Errorf("list categories: %w", err)
	}

	return ChartsData{
		DailyEntries:   dailyEntries,
		DailyReads:     dailyReads,
		DailySaved:     dailySaved,
		BacklogTrend:   backlogTrend,
		ReadThrough:    readThrough,
		DailyRefreshes: dailyRefreshes,
		RefreshStats:   stats,
		Feeds:          feeds,
		Categories:     cats,
	}, nil
}

func (s *ChartsService) queryDailyCounts(ctx context.Context, userID int64, feedID *int64, since time.Time, query string) []DailyCount {
	rows, err := s.pool.Query(ctx, query, userID, since, feedID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var counts []DailyCount
	for rows.Next() {
		var d time.Time
		var c int
		if err := rows.Scan(&d, &c); err != nil {
			continue
		}
		counts = append(counts, DailyCount{Date: d.Format("2006-01-02"), Count: c})
	}
	return counts
}

func (s *ChartsService) queryDailyRefreshes(ctx context.Context, userID int64, feedID *int64, since time.Time, days int) []DailyRefresh {
	rows, err := s.pool.Query(ctx, `
		SELECT DATE(fr.refreshed_at) as d,
			COUNT(*) FILTER (WHERE fr.was_successful) as successes,
			COUNT(*) FILTER (WHERE NOT fr.was_successful) as failures,
			COALESCE(SUM(fr.entries_created), 0) as entries_created
		FROM feed_refreshes fr
		JOIN feed_subscriptions fs ON fr.feed_id = fs.feed_id AND fs.user_id = $1
		WHERE fr.refreshed_at >= $2
			AND ($3::bigint IS NULL OR fr.feed_id = $3)
		GROUP BY d ORDER BY d`, userID, since, feedID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	dataMap := make(map[string]DailyRefresh)
	for rows.Next() {
		var d time.Time
		var dr DailyRefresh
		if err := rows.Scan(&d, &dr.Successes, &dr.Failures, &dr.EntriesCreated); err != nil {
			continue
		}
		dr.Date = d.Format("2006-01-02")
		dr.TotalAttempts = dr.Successes + dr.Failures
		if dr.TotalAttempts > 0 {
			rate := math.Round(float64(dr.Successes)/float64(dr.TotalAttempts)*10000) / 100
			dr.SuccessRate = &rate
		}
		dataMap[dr.Date] = dr
	}

	var result []DailyRefresh
	for d := 0; d < days; d++ {
		date := since.AddDate(0, 0, d).Format("2006-01-02")
		if dr, ok := dataMap[date]; ok {
			result = append(result, dr)
		} else {
			result = append(result, DailyRefresh{Date: date})
		}
	}
	return result
}

func ComputeBacklogTrend(entries, reads []DailyCount, since time.Time, days int) []DailyBacklog {
	entryMap := make(map[string]int)
	for _, e := range entries {
		entryMap[e.Date] = e.Count
	}
	readMap := make(map[string]int)
	for _, r := range reads {
		readMap[r.Date] = r.Count
	}

	var result []DailyBacklog
	runningBacklog := 0
	for d := 0; d < days; d++ {
		date := since.AddDate(0, 0, d).Format("2006-01-02")
		runningBacklog += entryMap[date] - readMap[date]
		result = append(result, DailyBacklog{Date: date, Backlog: runningBacklog})
	}
	return result
}

func ComputeReadThrough(entries, reads []DailyCount, since time.Time, days int) []DailyReadThrough {
	entryMap := make(map[string]int)
	for _, e := range entries {
		entryMap[e.Date] = e.Count
	}
	readMap := make(map[string]int)
	for _, r := range reads {
		readMap[r.Date] = r.Count
	}

	var result []DailyReadThrough
	for d := 0; d < days; d++ {
		date := since.AddDate(0, 0, d).Format("2006-01-02")
		e := entryMap[date]
		r := readMap[date]
		var pct *float64
		if e > 0 {
			v := math.Round(float64(r)/float64(e)*10000) / 100
			pct = &v
		}
		result = append(result, DailyReadThrough{Date: date, Percentage: pct})
	}
	return result
}

func SafePercent(num, denom int) float64 {
	if denom == 0 {
		return 0
	}
	return math.Round(float64(num)/float64(denom)*10000) / 100
}

func SumCounts(counts []DailyCount) int {
	total := 0
	for _, c := range counts {
		total += c.Count
	}
	return total
}

func CurrentBacklog(trend []DailyBacklog) int {
	if len(trend) == 0 {
		return 0
	}
	return trend[len(trend)-1].Backlog
}

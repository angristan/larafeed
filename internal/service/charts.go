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
	RangeDays        int
	StartDate        time.Time
	EndDate          time.Time
	FeedIDFilter     *int64
	CategoryIDFilter *int64
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
	startDate := params.StartDate
	endDate := params.EndDate
	if params.RangeDays <= 0 || startDate.IsZero() || endDate.IsZero() {
		params.RangeDays = 30
		endDate = dateOnly(time.Now())
		startDate = endDate.AddDate(0, 0, -(params.RangeDays - 1))
	}
	endExclusive := endDate.AddDate(0, 0, 1)

	dailyEntries, err := s.queryDailyCounts(ctx, userID, params, startDate, endExclusive, `
			SELECT DATE(e.published_at AT TIME ZONE 'UTC') as d, COUNT(*) as c
			FROM entries e
			JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
			LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = $1
			WHERE e.published_at >= $2 AND e.published_at < $3
				AND ei.filtered_at IS NULL
				AND ($4::bigint IS NULL OR e.feed_id = $4)
				AND ($5::bigint IS NULL OR fs.category_id = $5)
			GROUP BY d ORDER BY d`)
	if err != nil {
		return ChartsData{}, fmt.Errorf("get daily entries: %w", err)
	}

	dailyReads, err := s.queryDailyCounts(ctx, userID, params, startDate, endExclusive, `
			SELECT DATE(ei.read_at AT TIME ZONE 'UTC') as d, COUNT(*) as c
			FROM entry_interactions ei
			JOIN entries e ON ei.entry_id = e.id
			JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
			WHERE ei.read_at >= $2 AND ei.read_at < $3 AND ei.user_id = $1
				AND ($4::bigint IS NULL OR e.feed_id = $4)
				AND ($5::bigint IS NULL OR fs.category_id = $5)
			GROUP BY d ORDER BY d`)
	if err != nil {
		return ChartsData{}, fmt.Errorf("get daily reads: %w", err)
	}

	dailySaved, err := s.queryDailyCounts(ctx, userID, params, startDate, endExclusive, `
			SELECT DATE(ei.starred_at AT TIME ZONE 'UTC') as d, COUNT(*) as c
			FROM entry_interactions ei
			JOIN entries e ON ei.entry_id = e.id
			JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
			WHERE ei.starred_at >= $2 AND ei.starred_at < $3 AND ei.user_id = $1
				AND ($4::bigint IS NULL OR e.feed_id = $4)
				AND ($5::bigint IS NULL OR fs.category_id = $5)
			GROUP BY d ORDER BY d`)
	if err != nil {
		return ChartsData{}, fmt.Errorf("get daily saved entries: %w", err)
	}

	backlogTrend := ComputeBacklogTrend(dailyEntries, dailyReads, startDate, params.RangeDays)
	readThrough := ComputeReadThrough(dailyEntries, dailyReads, startDate, params.RangeDays)
	dailyRefreshes, err := s.queryDailyRefreshes(ctx, userID, params, startDate, endExclusive)
	if err != nil {
		return ChartsData{}, fmt.Errorf("get daily refreshes: %w", err)
	}

	stats, err := s.queryRefreshStats(ctx, userID, params, startDate, endExclusive)
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

func (s *ChartsService) queryDailyCounts(
	ctx context.Context,
	userID int64,
	params ChartsQuery,
	startDate time.Time,
	endExclusive time.Time,
	query string,
) ([]DailyCount, error) {
	rows, err := s.pool.Query(
		ctx,
		query,
		userID,
		startDate,
		endExclusive,
		params.FeedIDFilter,
		params.CategoryIDFilter,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var counts []DailyCount
	for rows.Next() {
		var d time.Time
		var c int
		err := rows.Scan(&d, &c)
		if err != nil {
			return nil, err
		}
		counts = append(counts, DailyCount{Date: d.Format("2006-01-02"), Count: c})
	}
	err = rows.Err()
	if err != nil {
		return nil, err
	}
	return counts, nil
}

func (s *ChartsService) queryDailyRefreshes(
	ctx context.Context,
	userID int64,
	params ChartsQuery,
	startDate time.Time,
	endExclusive time.Time,
) ([]DailyRefresh, error) {
	rows, err := s.pool.Query(ctx, `
			SELECT DATE(fr.refreshed_at AT TIME ZONE 'UTC') as d,
				COUNT(*) FILTER (WHERE fr.was_successful) as successes,
				COUNT(*) FILTER (WHERE NOT fr.was_successful) as failures,
				COALESCE(SUM(fr.entries_created), 0) as entries_created
			FROM feed_refreshes fr
			JOIN feed_subscriptions fs ON fr.feed_id = fs.feed_id AND fs.user_id = $1
			WHERE fr.refreshed_at >= $2 AND fr.refreshed_at < $3
				AND ($4::bigint IS NULL OR fr.feed_id = $4)
				AND ($5::bigint IS NULL OR fs.category_id = $5)
			GROUP BY d ORDER BY d`,
		userID,
		startDate,
		endExclusive,
		params.FeedIDFilter,
		params.CategoryIDFilter,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	dataMap := make(map[string]DailyRefresh)
	for rows.Next() {
		var d time.Time
		var dr DailyRefresh
		err := rows.Scan(&d, &dr.Successes, &dr.Failures, &dr.EntriesCreated)
		if err != nil {
			return nil, err
		}
		dr.Date = d.Format("2006-01-02")
		dr.TotalAttempts = dr.Successes + dr.Failures
		if dr.TotalAttempts > 0 {
			rate := math.Round(float64(dr.Successes)/float64(dr.TotalAttempts)*10000) / 100
			dr.SuccessRate = &rate
		}
		dataMap[dr.Date] = dr
	}
	err = rows.Err()
	if err != nil {
		return nil, err
	}

	var result []DailyRefresh
	for d := 0; d < params.RangeDays; d++ {
		date := startDate.AddDate(0, 0, d).Format("2006-01-02")
		if dr, ok := dataMap[date]; ok {
			result = append(result, dr)
		} else {
			result = append(result, DailyRefresh{Date: date})
		}
	}
	return result, nil
}

func (s *ChartsService) queryRefreshStats(
	ctx context.Context,
	userID int64,
	params ChartsQuery,
	startDate time.Time,
	endExclusive time.Time,
) (db.GetRefreshStatsRow, error) {
	row := s.pool.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE fr.was_successful) AS successes,
			COUNT(*) FILTER (WHERE NOT fr.was_successful) AS failures,
			COALESCE(SUM(fr.entries_created) FILTER (WHERE fr.was_successful), 0)::bigint AS entries_created
		FROM feed_refreshes fr
		JOIN feed_subscriptions fs ON fr.feed_id = fs.feed_id AND fs.user_id = $1
		WHERE fr.refreshed_at >= $2 AND fr.refreshed_at < $3
			AND ($4::bigint IS NULL OR fr.feed_id = $4)
			AND ($5::bigint IS NULL OR fs.category_id = $5)`,
		userID,
		startDate,
		endExclusive,
		params.FeedIDFilter,
		params.CategoryIDFilter,
	)

	var stats db.GetRefreshStatsRow
	err := row.Scan(&stats.Successes, &stats.Failures, &stats.EntriesCreated)
	return stats, err
}

func dateOnly(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
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

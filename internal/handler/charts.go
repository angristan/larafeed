package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/db"
	gonertia "github.com/romsar/gonertia/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

type ChartsHandler struct {
	inertia *gonertia.Inertia
	pool    *pgxpool.Pool
	q       *db.Queries
}

func NewChartsHandler(i *gonertia.Inertia, pool *pgxpool.Pool, q *db.Queries) *ChartsHandler {
	return &ChartsHandler{inertia: i, pool: pool, q: q}
}

type DailyCount struct {
	Date  string `json:"date"`
	Count int    `json:"count"`
}

// Frontend-facing DTOs with expected field names
type dailyReadsDTO struct {
	Date  string `json:"date"`
	Reads int    `json:"reads"`
}

type dailyEntriesDTO struct {
	Date    string `json:"date"`
	Entries int    `json:"entries"`
}

type dailySavedDTO struct {
	Date  string `json:"date"`
	Saved int    `json:"saved"`
}

type dailyBacklogDTO struct {
	Date  string `json:"date"`
	Value int    `json:"value"`
}

type dailyReadThroughDTO struct {
	Date  string   `json:"date"`
	Value *float64 `json:"value"`
}

type selectEntityDTO struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
}

// Internal types for computation (not sent to frontend directly)
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

func (h *ChartsHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	q := r.URL.Query()

	// Date range
	rangeDays := 30
	if v := q.Get("range"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 {
			rangeDays = d
		}
	}
	since := time.Now().AddDate(0, 0, -rangeDays)

	var feedIDFilter *int64
	if v := q.Get("feedId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			feedIDFilter = &id
		}
	}

	// Daily entries published
	dailyEntries := h.queryDailyCounts(r, user.ID, feedIDFilter, since, `
		SELECT DATE(e.published_at) as d, COUNT(*) as c
		FROM entries e
		JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
		LEFT JOIN entry_interactions ei ON e.id = ei.entry_id AND ei.user_id = $1
		WHERE e.published_at >= $2 AND (ei.filtered_at IS NULL)
			AND ($3::bigint IS NULL OR e.feed_id = $3)
		GROUP BY d ORDER BY d`)

	// Daily reads
	dailyReads := h.queryDailyCounts(r, user.ID, feedIDFilter, since, `
		SELECT DATE(ei.read_at) as d, COUNT(*) as c
		FROM entry_interactions ei
		JOIN entries e ON ei.entry_id = e.id
		JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
		WHERE ei.read_at >= $2 AND ei.user_id = $1
			AND ($3::bigint IS NULL OR e.feed_id = $3)
		GROUP BY d ORDER BY d`)

	// Daily starred
	dailySaved := h.queryDailyCounts(r, user.ID, feedIDFilter, since, `
		SELECT DATE(ei.starred_at) as d, COUNT(*) as c
		FROM entry_interactions ei
		JOIN entries e ON ei.entry_id = e.id
		JOIN feed_subscriptions fs ON e.feed_id = fs.feed_id AND fs.user_id = $1
		WHERE ei.starred_at >= $2 AND ei.user_id = $1
			AND ($3::bigint IS NULL OR e.feed_id = $3)
		GROUP BY d ORDER BY d`)

	// Backlog trend: cumulative unread = entries - reads per day
	backlogRaw := computeBacklogTrend(dailyEntries, dailyReads, since, rangeDays)

	// Read-through: percentage of entries read each day
	readThroughRaw := computeReadThrough(dailyEntries, dailyReads, since, rangeDays)

	// Daily refreshes
	dailyRefreshes := h.queryDailyRefreshes(r, user.ID, feedIDFilter, since, rangeDays)

	// Refresh stats
	stats, _ := h.q.GetRefreshStats(r.Context(), db.GetRefreshStatsParams{UserID: user.ID, RefreshedAt: since})

	feeds, _ := h.q.ListSubscriptionsForUser(r.Context(), user.ID)
	cats, _ := h.q.ListCategoriesForUser(r.Context(), user.ID)

	// Transform to frontend-expected shapes
	readsDTO := make([]dailyReadsDTO, len(dailyReads))
	for i, d := range dailyReads {
		readsDTO[i] = dailyReadsDTO{Date: d.Date, Reads: d.Count}
	}
	entriesDTO := make([]dailyEntriesDTO, len(dailyEntries))
	for i, d := range dailyEntries {
		entriesDTO[i] = dailyEntriesDTO{Date: d.Date, Entries: d.Count}
	}
	savedDTO := make([]dailySavedDTO, len(dailySaved))
	for i, d := range dailySaved {
		savedDTO[i] = dailySavedDTO{Date: d.Date, Saved: d.Count}
	}
	backlogDTO := make([]dailyBacklogDTO, len(backlogRaw))
	for i, b := range backlogRaw {
		backlogDTO[i] = dailyBacklogDTO{Date: b.Date, Value: b.Backlog}
	}
	readThroughDTO := make([]dailyReadThroughDTO, len(readThroughRaw))
	for i, rt := range readThroughRaw {
		readThroughDTO[i] = dailyReadThroughDTO{Date: rt.Date, Value: rt.Percentage}
	}

	// Transform feeds/categories to {id, name} for selects
	feedEntities := make([]selectEntityDTO, len(feeds))
	for i, f := range feeds {
		name := f.Name
		if f.CustomFeedName != nil && *f.CustomFeedName != "" {
			name = *f.CustomFeedName
		}
		feedEntities[i] = selectEntityDTO{ID: f.ID, Name: name}
	}
	catEntities := make([]selectEntityDTO, len(cats))
	for i, c := range cats {
		catEntities[i] = selectEntityDTO{ID: c.ID, Name: c.Name}
	}

	totalAttempts := int(stats.Successes + stats.Failures)

	render(w, r, h.inertia, "Charts", gonertia.Props{
		"dailyEntries":   entriesDTO,
		"dailyReads":     readsDTO,
		"dailySaved":     savedDTO,
		"backlogTrend":   backlogDTO,
		"readThrough":    readThroughDTO,
		"dailyRefreshes": dailyRefreshes,
		"refreshSummary": map[string]any{
			"totalAttempts":  totalAttempts,
			"successes":      stats.Successes,
			"failures":       stats.Failures,
			"entriesCreated": stats.EntriesCreated,
			"successRate":    safePercent(int(stats.Successes), totalAttempts),
		},
		"summary": map[string]any{
			"totalEntries":   sumCounts(dailyEntries),
			"totalReads":     sumCounts(dailyReads),
			"totalSaved":     sumCounts(dailySaved),
			"readThroughRate": safePercent(sumCounts(dailyReads), sumCounts(dailyEntries)),
			"currentBacklog":  currentBacklog(backlogRaw),
		},
		"filters": map[string]any{
			"range":      strconv.Itoa(rangeDays),
			"group":      "all",
			"feedId":     feedIDFilter,
			"categoryId": nil,
			"startDate":  since.Format("2006-01-02"),
			"endDate":    time.Now().Format("2006-01-02"),
		},
		"feeds":      feedEntities,
		"categories": catEntities,
	})
}

func (h *ChartsHandler) queryDailyCounts(r *http.Request, userID int64, feedID *int64, since time.Time, query string) []DailyCount {
	rows, err := h.pool.Query(r.Context(), query, userID, since, feedID)
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

func safePercent(num, denom int) float64 {
	if denom == 0 {
		return 0
	}
	return float64(num) / float64(denom) * 100
}

func sumCounts(counts []DailyCount) int {
	total := 0
	for _, c := range counts {
		total += c.Count
	}
	return total
}

func currentBacklog(trend []DailyBacklog) int {
	if len(trend) == 0 {
		return 0
	}
	return trend[len(trend)-1].Backlog
}

func computeBacklogTrend(entries, reads []DailyCount, since time.Time, days int) []DailyBacklog {
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

func computeReadThrough(entries, reads []DailyCount, since time.Time, days int) []DailyReadThrough {
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
			v := float64(r) / float64(e) * 100
			pct = &v
		}
		result = append(result, DailyReadThrough{Date: date, Percentage: pct})
	}
	return result
}

func (h *ChartsHandler) queryDailyRefreshes(r *http.Request, userID int64, feedID *int64, since time.Time, days int) []DailyRefresh {
	rows, err := h.pool.Query(r.Context(), `
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
			rate := float64(dr.Successes) / float64(dr.TotalAttempts) * 100
			dr.SuccessRate = &rate
		}
		dataMap[dr.Date] = dr
	}

	// Fill all dates in range
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

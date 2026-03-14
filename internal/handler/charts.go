package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/service"
	gonertia "github.com/romsar/gonertia/v2"
)

type ChartsHandler struct {
	inertia   *gonertia.Inertia
	chartsSvc chartsService
}

func NewChartsHandler(i *gonertia.Inertia, chartsSvc chartsService) *ChartsHandler {
	return &ChartsHandler{inertia: i, chartsSvc: chartsSvc}
}

// Frontend-facing DTOs
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

func (h *ChartsHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	q := r.URL.Query()

	rangeDays := 30
	if v := q.Get("range"); v != "" {
		if d, err := strconv.Atoi(v); err == nil && d > 0 {
			rangeDays = d
		}
	}

	var feedIDFilter *int64
	if v := q.Get("feedId"); v != "" {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil {
			feedIDFilter = &id
		}
	}

	data := h.chartsSvc.GetChartsData(r.Context(), user.ID, service.ChartsQuery{
		RangeDays:    rangeDays,
		FeedIDFilter: feedIDFilter,
	})

	// Transform to frontend-expected shapes
	readsDTO := make([]dailyReadsDTO, len(data.DailyReads))
	for i, d := range data.DailyReads {
		readsDTO[i] = dailyReadsDTO{Date: d.Date, Reads: d.Count}
	}
	entriesDTO := make([]dailyEntriesDTO, len(data.DailyEntries))
	for i, d := range data.DailyEntries {
		entriesDTO[i] = dailyEntriesDTO{Date: d.Date, Entries: d.Count}
	}
	savedDTO := make([]dailySavedDTO, len(data.DailySaved))
	for i, d := range data.DailySaved {
		savedDTO[i] = dailySavedDTO{Date: d.Date, Saved: d.Count}
	}
	backlogDTO := make([]dailyBacklogDTO, len(data.BacklogTrend))
	for i, b := range data.BacklogTrend {
		backlogDTO[i] = dailyBacklogDTO{Date: b.Date, Value: b.Backlog}
	}
	readThroughDTO := make([]dailyReadThroughDTO, len(data.ReadThrough))
	for i, rt := range data.ReadThrough {
		readThroughDTO[i] = dailyReadThroughDTO{Date: rt.Date, Value: rt.Percentage}
	}

	feedEntities := make([]selectEntityDTO, len(data.Feeds))
	for i, f := range data.Feeds {
		name := f.Name
		if f.CustomFeedName != nil && *f.CustomFeedName != "" {
			name = *f.CustomFeedName
		}
		feedEntities[i] = selectEntityDTO{ID: f.ID, Name: name}
	}
	catEntities := make([]selectEntityDTO, len(data.Categories))
	for i, c := range data.Categories {
		catEntities[i] = selectEntityDTO{ID: c.ID, Name: c.Name}
	}

	totalAttempts := int(data.RefreshStats.Successes + data.RefreshStats.Failures)
	since := time.Now().AddDate(0, 0, -rangeDays)

	render(w, r, h.inertia, "Charts", gonertia.Props{
		"dailyEntries":   entriesDTO,
		"dailyReads":     readsDTO,
		"dailySaved":     savedDTO,
		"backlogTrend":   backlogDTO,
		"readThrough":    readThroughDTO,
		"dailyRefreshes": data.DailyRefreshes,
		"refreshSummary": map[string]any{
			"totalAttempts":  totalAttempts,
			"successes":      data.RefreshStats.Successes,
			"failures":       data.RefreshStats.Failures,
			"entriesCreated": data.RefreshStats.EntriesCreated,
			"successRate":    service.SafePercent(int(data.RefreshStats.Successes), totalAttempts),
		},
		"summary": map[string]any{
			"totalEntries":    service.SumCounts(data.DailyEntries),
			"totalReads":      service.SumCounts(data.DailyReads),
			"totalSaved":      service.SumCounts(data.DailySaved),
			"readThroughRate": service.SafePercent(service.SumCounts(data.DailyReads), service.SumCounts(data.DailyEntries)),
			"currentBacklog":  service.CurrentBacklog(data.BacklogTrend),
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

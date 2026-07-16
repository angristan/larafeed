package handler

import (
	"net/http"
	"net/url"
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

const (
	chartsDateLayout         = "2006-01-02"
	defaultChartsRangeDays   = 30
	maximumChartsRangeDays   = 366
	defaultChartsRangeFilter = "30"
)

var chartsPresetRanges = map[string]int{
	"30":  30,
	"90":  90,
	"365": 365,
}

type chartsFilters struct {
	Range      string
	Group      string
	FeedID     *int64
	CategoryID *int64
	StartDate  time.Time
	EndDate    time.Time
	RangeDays  int
}

func parseChartsFilters(values url.Values, now time.Time) chartsFilters {
	today := dateOnlyUTC(now)
	filters := chartsFilters{
		Range:     defaultChartsRangeFilter,
		Group:     "all",
		StartDate: today.AddDate(0, 0, -(defaultChartsRangeDays - 1)),
		EndDate:   today,
		RangeDays: defaultChartsRangeDays,
	}

	if days, ok := chartsPresetRanges[values.Get("range")]; ok {
		filters.Range = values.Get("range")
		filters.RangeDays = days
		filters.StartDate = today.AddDate(0, 0, -(days - 1))
	} else if values.Get("range") == "custom" {
		startDate, startErr := time.Parse(chartsDateLayout, values.Get("startDate"))
		endDate, endErr := time.Parse(chartsDateLayout, values.Get("endDate"))
		if startErr == nil && endErr == nil && !startDate.After(endDate) {
			days := int(endDate.Sub(startDate).Hours()/24) + 1
			if days <= maximumChartsRangeDays {
				filters.Range = "custom"
				filters.StartDate = startDate
				filters.EndDate = endDate
				filters.RangeDays = days
			}
		}
	}

	feedID := positiveInt64(values.Get("feedId"))
	categoryID := positiveInt64(values.Get("categoryId"))
	switch values.Get("group") {
	case "feed":
		if feedID != nil {
			filters.Group = "feed"
			filters.FeedID = feedID
		}
	case "category":
		if categoryID != nil {
			filters.Group = "category"
			filters.CategoryID = categoryID
		}
	case "", "all":
		// Preserve old feedId/categoryId-only chart URLs while preferring the
		// explicit group value sent by the current frontend.
		if values.Get("group") == "" && feedID != nil {
			filters.Group = "feed"
			filters.FeedID = feedID
		} else if values.Get("group") == "" && categoryID != nil {
			filters.Group = "category"
			filters.CategoryID = categoryID
		}
	}

	return filters
}

func dateOnlyUTC(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func positiveInt64(value string) *int64 {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return nil
	}
	return &id
}

func (f chartsFilters) serviceQuery() service.ChartsQuery {
	return service.ChartsQuery{
		RangeDays:        f.RangeDays,
		StartDate:        f.StartDate,
		EndDate:          f.EndDate,
		FeedIDFilter:     f.FeedID,
		CategoryIDFilter: f.CategoryID,
	}
}

func (f chartsFilters) props() map[string]any {
	return map[string]any{
		"range":      f.Range,
		"group":      f.Group,
		"feedId":     nullableInt64(f.FeedID),
		"categoryId": nullableInt64(f.CategoryID),
		"startDate":  f.StartDate.Format(chartsDateLayout),
		"endDate":    f.EndDate.Format(chartsDateLayout),
	}
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func (h *ChartsHandler) Show(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromRequest(r)
	filters := parseChartsFilters(r.URL.Query(), time.Now())

	data, err := h.chartsSvc.GetChartsData(r.Context(), user.ID, filters.serviceQuery())
	if err != nil {
		renderError(w, r, h.inertia, http.StatusInternalServerError, err)
		return
	}

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
		"filters":    filters.props(),
		"feeds":      feedEntities,
		"categories": catEntities,
	})
}

package handler

import (
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseChartsFilters(t *testing.T) {
	now := time.Date(2026, time.July, 12, 18, 30, 0, 0, time.FixedZone("test", 2*60*60))

	tests := []struct {
		name           string
		query          url.Values
		wantRange      string
		wantGroup      string
		wantFeedID     *int64
		wantCategoryID *int64
		wantStart      string
		wantEnd        string
		wantDays       int
	}{
		{
			name:      "defaults",
			query:     url.Values{},
			wantRange: "30",
			wantGroup: "all",
			wantStart: "2026-06-13",
			wantEnd:   "2026-07-12",
			wantDays:  30,
		},
		{
			name:       "preset feed",
			query:      url.Values{"range": {"90"}, "group": {"feed"}, "feedId": {"42"}},
			wantRange:  "90",
			wantGroup:  "feed",
			wantFeedID: int64Pointer(42),
			wantStart:  "2026-04-14",
			wantEnd:    "2026-07-12",
			wantDays:   90,
		},
		{
			name: "custom category",
			query: url.Values{
				"range":      {"custom"},
				"group":      {"category"},
				"categoryId": {"7"},
				"startDate":  {"2026-07-01"},
				"endDate":    {"2026-07-12"},
			},
			wantRange:      "custom",
			wantGroup:      "category",
			wantCategoryID: int64Pointer(7),
			wantStart:      "2026-07-01",
			wantEnd:        "2026-07-12",
			wantDays:       12,
		},
		{
			name:       "legacy feed id infers group",
			query:      url.Values{"feedId": {"9"}},
			wantRange:  "30",
			wantGroup:  "feed",
			wantFeedID: int64Pointer(9),
			wantStart:  "2026-06-13",
			wantEnd:    "2026-07-12",
			wantDays:   30,
		},
		{
			name: "invalid values fall back safely",
			query: url.Values{
				"range":     {"custom"},
				"group":     {"feed"},
				"feedId":    {"-1"},
				"startDate": {"2026-07-12"},
				"endDate":   {"2026-07-01"},
			},
			wantRange: "30",
			wantGroup: "all",
			wantStart: "2026-06-13",
			wantEnd:   "2026-07-12",
			wantDays:  30,
		},
		{
			name: "oversized custom range falls back safely",
			query: url.Values{
				"range":     {"custom"},
				"startDate": {"2025-07-11"},
				"endDate":   {"2026-07-12"},
			},
			wantRange: "30",
			wantGroup: "all",
			wantStart: "2026-06-13",
			wantEnd:   "2026-07-12",
			wantDays:  30,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			filters := parseChartsFilters(tt.query, now)

			assert.Equal(t, tt.wantRange, filters.Range)
			assert.Equal(t, tt.wantGroup, filters.Group)
			assert.Equal(t, tt.wantFeedID, filters.FeedID)
			assert.Equal(t, tt.wantCategoryID, filters.CategoryID)
			assert.Equal(t, tt.wantStart, filters.StartDate.Format(chartsDateLayout))
			assert.Equal(t, tt.wantEnd, filters.EndDate.Format(chartsDateLayout))
			assert.Equal(t, tt.wantDays, filters.RangeDays)
		})
	}
}

func TestChartsFiltersPropsAndServiceQuery(t *testing.T) {
	filters := parseChartsFilters(url.Values{
		"range":      {"custom"},
		"group":      {"category"},
		"categoryId": {"7"},
		"startDate":  {"2026-07-01"},
		"endDate":    {"2026-07-12"},
	}, time.Date(2026, time.July, 12, 0, 0, 0, 0, time.UTC))

	assert.Equal(t, map[string]any{
		"range":      "custom",
		"group":      "category",
		"feedId":     nil,
		"categoryId": int64(7),
		"startDate":  "2026-07-01",
		"endDate":    "2026-07-12",
	}, filters.props())

	query := filters.serviceQuery()
	assert.Equal(t, 12, query.RangeDays)
	assert.Equal(t, filters.StartDate, query.StartDate)
	assert.Equal(t, filters.EndDate, query.EndDate)
	assert.Nil(t, query.FeedIDFilter)
	require.NotNil(t, query.CategoryIDFilter)
	assert.Equal(t, int64(7), *query.CategoryIDFilter)
}

func int64Pointer(value int64) *int64 {
	return &value
}

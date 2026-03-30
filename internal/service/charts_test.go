package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var testSince = time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)

func TestSafePercent(t *testing.T) {
	assert.Equal(t, 50.0, SafePercent(50, 100))
	assert.Equal(t, 0.0, SafePercent(10, 0))
	assert.Equal(t, 33.33, SafePercent(1, 3))
	assert.Equal(t, 100.0, SafePercent(5, 5))
	assert.Equal(t, 0.0, SafePercent(0, 100))
}

func TestSumCounts(t *testing.T) {
	assert.Equal(t, 0, SumCounts(nil))
	assert.Equal(t, 0, SumCounts([]DailyCount{}))
	assert.Equal(t, 5, SumCounts([]DailyCount{{Count: 5}}))
	assert.Equal(t, 15, SumCounts([]DailyCount{{Count: 5}, {Count: 3}, {Count: 7}}))
}

func TestCurrentBacklog(t *testing.T) {
	assert.Equal(t, 0, CurrentBacklog(nil))
	assert.Equal(t, 0, CurrentBacklog([]DailyBacklog{}))
	assert.Equal(t, 10, CurrentBacklog([]DailyBacklog{{Backlog: 10}}))
	assert.Equal(t, 3, CurrentBacklog([]DailyBacklog{{Backlog: 10}, {Backlog: 7}, {Backlog: 3}}))
}

func TestComputeBacklogTrend_Empty(t *testing.T) {
	trend := ComputeBacklogTrend(nil, nil, testSince, 3)
	require.Len(t, trend, 3)
	for _, b := range trend {
		assert.Equal(t, 0, b.Backlog)
	}
	assert.Equal(t, "2024-01-01", trend[0].Date)
	assert.Equal(t, "2024-01-02", trend[1].Date)
	assert.Equal(t, "2024-01-03", trend[2].Date)
}

func TestComputeBacklogTrend_Accumulates(t *testing.T) {
	entries := []DailyCount{
		{Date: "2024-01-01", Count: 10},
		{Date: "2024-01-02", Count: 5},
	}
	reads := []DailyCount{
		{Date: "2024-01-01", Count: 3},
		{Date: "2024-01-03", Count: 2},
	}

	trend := ComputeBacklogTrend(entries, reads, testSince, 3)
	require.Len(t, trend, 3)
	assert.Equal(t, 7, trend[0].Backlog)  // 10-3 = 7
	assert.Equal(t, 12, trend[1].Backlog) // 7 + 5-0 = 12
	assert.Equal(t, 10, trend[2].Backlog) // 12 + 0-2 = 10
}

func TestComputeBacklogTrend_NegativeBacklog(t *testing.T) {
	entries := []DailyCount{{Date: "2024-01-01", Count: 2}}
	reads := []DailyCount{{Date: "2024-01-01", Count: 5}}

	trend := ComputeBacklogTrend(entries, reads, testSince, 1)
	require.Len(t, trend, 1)
	assert.Equal(t, -3, trend[0].Backlog)
}

func TestComputeReadThrough_Empty(t *testing.T) {
	rt := ComputeReadThrough(nil, nil, testSince, 3)
	require.Len(t, rt, 3)
	for _, r := range rt {
		assert.Nil(t, r.Percentage, "days with 0 entries should have nil percentage")
	}
}

func TestComputeReadThrough_Full(t *testing.T) {
	entries := []DailyCount{{Date: "2024-01-01", Count: 10}}
	reads := []DailyCount{{Date: "2024-01-01", Count: 10}}

	rt := ComputeReadThrough(entries, reads, testSince, 1)
	require.Len(t, rt, 1)
	require.NotNil(t, rt[0].Percentage)
	assert.Equal(t, 100.0, *rt[0].Percentage)
}

func TestComputeReadThrough_Partial(t *testing.T) {
	entries := []DailyCount{{Date: "2024-01-01", Count: 3}}
	reads := []DailyCount{{Date: "2024-01-01", Count: 1}}

	rt := ComputeReadThrough(entries, reads, testSince, 1)
	require.Len(t, rt, 1)
	require.NotNil(t, rt[0].Percentage)
	assert.Equal(t, 33.33, *rt[0].Percentage)
}

func TestComputeReadThrough_MixedDays(t *testing.T) {
	entries := []DailyCount{
		{Date: "2024-01-01", Count: 10},
		// No entries on 2024-01-02
		{Date: "2024-01-03", Count: 4},
	}
	reads := []DailyCount{
		{Date: "2024-01-01", Count: 5},
		{Date: "2024-01-03", Count: 4},
	}

	rt := ComputeReadThrough(entries, reads, testSince, 3)
	require.Len(t, rt, 3)
	require.NotNil(t, rt[0].Percentage)
	assert.Equal(t, 50.0, *rt[0].Percentage)
	assert.Nil(t, rt[1].Percentage, "no entries = nil percentage")
	require.NotNil(t, rt[2].Percentage)
	assert.Equal(t, 100.0, *rt[2].Percentage)
}

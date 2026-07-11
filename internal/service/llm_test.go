package service

import (
	"context"
	"testing"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/db/mocks"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
)

func TestLLMService_Enabled(t *testing.T) {
	t.Run("enabled when API key is set", func(t *testing.T) {
		svc := NewLLMService("api-key", nil)
		assert.True(t, svc.Enabled())
	})

	t.Run("disabled when API key is empty", func(t *testing.T) {
		svc := NewLLMService("", nil)
		assert.False(t, svc.Enabled())
	})
}

func TestLLMService_SummarizeEntry_WhenDisabled(t *testing.T) {
	svc := NewLLMService("", nil)
	result, err := svc.SummarizeEntry(context.Background(), nil)
	assert.Error(t, err)
	assert.Equal(t, "LLM not configured", err.Error())
	assert.Empty(t, result)
}

func TestLLMService_SummarizeEntry_SanitizesCachedSummary(t *testing.T) {
	q := mocks.NewQuerier(t)
	q.On("CacheGet", mock.Anything, "entry_42_llm_summary").Return(db.CacheGetRow{
		Value:      `<p onclick="alert(1)">Safe <strong style="color:red">summary</strong></p><script>alert(2)</script><img src=x onerror="alert(3)"><a href="javascript:alert(4)">link</a>`,
		Expiration: int(time.Now().Add(time.Hour).Unix()),
	}, nil)

	svc := NewLLMService("api-key", q)
	summary, err := svc.SummarizeEntry(context.Background(), &db.Entry{ID: 42})

	require.NoError(t, err)
	assert.Contains(t, summary, `<p>Safe <strong>summary</strong></p>`)
	assert.Contains(t, summary, "link")
	assert.NotContains(t, summary, "onclick")
	assert.NotContains(t, summary, "style=")
	assert.NotContains(t, summary, "<script")
	assert.NotContains(t, summary, "alert(2)")
	assert.NotContains(t, summary, "<img")
	assert.NotContains(t, summary, "href=")
	q.AssertNotCalled(t, "CacheSet", mock.Anything, mock.Anything)
}

func TestSanitizeLLMSummary_UsesSafeFallbackForForbiddenOnlyOutput(t *testing.T) {
	summary := sanitizeLLMSummary(`<script>alert(1)</script><img src=x onerror="alert(2)">`)

	assert.Equal(t, safeSummaryFallback, summary)
}

package service

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
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

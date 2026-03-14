package service

import (
	"context"
	"fmt"
	"time"

	"github.com/angristan/larafeed-go/internal/db"
	"github.com/google/generative-ai-go/genai"
	"google.golang.org/api/option"
)

type LLMService struct {
	apiKey string
	q      db.Querier
}

func NewLLMService(apiKey string, q db.Querier) *LLMService {
	return &LLMService{apiKey: apiKey, q: q}
}

func (s *LLMService) Enabled() bool {
	return s.apiKey != ""
}

// SummarizeEntry generates an LLM summary for an entry.
func (s *LLMService) SummarizeEntry(ctx context.Context, entry *db.Entry) (string, error) {
	if !s.Enabled() {
		return "", fmt.Errorf("LLM not configured")
	}

	// Check cache
	cacheKey := fmt.Sprintf("entry_%d_llm_summary", entry.ID)
	cached, err := s.q.CacheGet(ctx, cacheKey)
	if err == nil && cached.Expiration > int(time.Now().Unix()) {
		return cached.Value, nil
	}

	content := ""
	if entry.Content != nil {
		content = *entry.Content
	}
	if content == "" {
		return "No content available to summarize.", nil
	}

	// Truncate content to avoid token limits
	if len(content) > 10000 {
		content = content[:10000]
	}

	client, err := genai.NewClient(ctx, option.WithAPIKey(s.apiKey))
	if err != nil {
		return "", fmt.Errorf("create genai client: %w", err)
	}
	defer client.Close()

	model := client.GenerativeModel("gemini-2.0-flash")
	model.SetMaxOutputTokens(512)

	prompt := fmt.Sprintf(`Summarize the following article in 3-4 sentences. Break your summary into short paragraphs using HTML <p> tags. If the article appears to be an aggregator post or excerpt, mention that. Use passive voice. Return HTML only, no markdown.

Title: %s
Content: %s`, entry.Title, content)

	resp, err := model.GenerateContent(ctx, genai.Text(prompt))
	if err != nil {
		return "", fmt.Errorf("generate content: %w", err)
	}

	if len(resp.Candidates) == 0 || len(resp.Candidates[0].Content.Parts) == 0 {
		return "Unable to generate summary.", nil
	}

	summary := fmt.Sprintf("%v", resp.Candidates[0].Content.Parts[0])

	// Cache for 30 days
	_ = s.q.CacheSet(ctx, db.CacheSetParams{Key: cacheKey, Value: summary, Expiration: int(time.Now().Add(30 * 24 * time.Hour).Unix())})

	return summary, nil
}

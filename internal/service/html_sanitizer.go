package service

import "github.com/microcosm-cc/bluemonday"

var entryContentPolicy = bluemonday.UGCPolicy()

func sanitizeEntryContent(htmlContent string) string {
	if htmlContent == "" {
		return ""
	}

	return entryContentPolicy.Sanitize(htmlContent)
}

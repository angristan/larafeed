package logging

import (
	"context"
	"log/slog"

	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/trace"
)

type contextKey string

const requestIDKey contextKey = "request_id"

// WithRequestID stores a request ID in the context for slog extraction.
func WithRequestID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, requestIDKey, id)
}

// ContextHandler wraps a slog.Handler to automatically include
// request_id from context in all log records.
type ContextHandler struct {
	inner slog.Handler
}

func NewContextHandler(inner slog.Handler) *ContextHandler {
	return &ContextHandler{inner: inner}
}

func (h *ContextHandler) Enabled(ctx context.Context, level slog.Level) bool {
	return h.inner.Enabled(ctx, level)
}

func (h *ContextHandler) Handle(ctx context.Context, r slog.Record) error {
	if id, ok := ctx.Value(requestIDKey).(string); ok && id != "" {
		r.AddAttrs(slog.String("request_id", id))
	} else if id := middleware.GetReqID(ctx); id != "" {
		r.AddAttrs(slog.String("request_id", id))
	}

	spanCtx := trace.SpanContextFromContext(ctx)
	if spanCtx.HasTraceID() {
		r.AddAttrs(slog.String("trace_id", spanCtx.TraceID().String()))
	}
	if spanCtx.HasSpanID() {
		r.AddAttrs(slog.String("span_id", spanCtx.SpanID().String()))
	}

	return h.inner.Handle(ctx, r)
}

func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{inner: h.inner.WithGroup(name)}
}

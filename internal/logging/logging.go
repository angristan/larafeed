package logging

import (
	"context"
	"errors"
	"log/slog"

	"github.com/go-chi/chi/v5/middleware"
	"go.opentelemetry.io/otel/codes"
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

	span := trace.SpanFromContext(ctx)
	spanCtx := span.SpanContext()
	if spanCtx.HasTraceID() {
		r.AddAttrs(slog.String("trace_id", spanCtx.TraceID().String()))
	}
	if spanCtx.HasSpanID() {
		r.AddAttrs(slog.String("span_id", spanCtx.SpanID().String()))
	}

	// Record error-level logs on the active span so they appear in Tempo.
	if r.Level >= slog.LevelError && spanCtx.IsValid() {
		span.SetStatus(codes.Error, r.Message)
		span.RecordError(errFromRecord(r))
	}

	return h.inner.Handle(ctx, r)
}

// errFromRecord extracts an error value from the slog record attributes,
// falling back to the message if none is found.
func errFromRecord(r slog.Record) error {
	var found error
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "error" || a.Key == "err" {
			if e, ok := a.Value.Any().(error); ok {
				found = e
				return false
			}
		}
		return true
	})
	if found != nil {
		return found
	}
	return errors.New(r.Message)
}

func (h *ContextHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &ContextHandler{inner: h.inner.WithAttrs(attrs)}
}

func (h *ContextHandler) WithGroup(name string) slog.Handler {
	return &ContextHandler{inner: h.inner.WithGroup(name)}
}

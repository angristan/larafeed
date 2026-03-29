package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/logging"
	"github.com/angristan/larafeed-go/internal/server"
	"github.com/angristan/larafeed-go/internal/telemetry"
	"github.com/go-chi/chi/v5"
	"riverqueue.com/riverui"
)

// requireAuthAPI returns 401 for unauthenticated requests (for non-Inertia routes like River UI).
func requireAuthAPI(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if auth.UserFromContext(r.Context()) == nil {
			http.Error(w, "Unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	// Set up structured logging with request ID extraction from context.
	slog.SetDefault(slog.New(logging.NewContextHandler(
		slog.NewTextHandler(os.Stderr, nil),
	)))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := config.Load()
	err := cfg.Validate()
	if err != nil {
		slog.Error("invalid configuration", "error", err)
		os.Exit(1)
	}

	// Initialize OpenTelemetry tracing (no-op if OTEL_EXPORTER_OTLP_ENDPOINT is unset)
	otelShutdown, err := telemetry.Setup(ctx, cfg.AppName, cfg.AppEnv)
	if err != nil {
		slog.Error("failed to initialize telemetry", "error", err)
		os.Exit(1)
	}
	defer func() {
		err := otelShutdown(ctx)
		if err != nil {
			slog.Error("telemetry shutdown error", "error", err)
		}
	}()

	// Connect to database
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	srv, riverClient, err := server.New(ctx, cfg, pool)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	// Mount River UI (behind auth)
	endpoints := riverui.NewEndpoints(riverClient, nil)
	riverHandler, err := riverui.NewHandler(&riverui.HandlerOpts{
		Endpoints: endpoints,
		Logger:    slog.Default(),
		Prefix:    "/jobs",
	})
	if err != nil {
		slog.Error("failed to create River UI handler", "error", err)
		os.Exit(1)
	}
	err = riverHandler.Start(ctx)
	if err != nil {
		slog.Error("failed to start River UI handler", "error", err)
		os.Exit(1)
	}
	srv.Group(func(r chi.Router) {
		r.Use(requireAuthAPI)
		r.Mount("/jobs", riverHandler)
	})

	addr := fmt.Sprintf(":%s", cfg.Port)
	httpServer := &http.Server{Addr: addr, Handler: srv}

	// Graceful shutdown
	shutdownDone := make(chan struct{})
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigCh
		slog.Info("shutting down...", "signal", sig)

		// 1. Stop accepting new HTTP connections; finish in-flight requests.
		httpCtx, httpCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer httpCancel()
		err := httpServer.Shutdown(httpCtx)
		if err != nil {
			slog.Error("http server shutdown error", "error", err)
		}

		// 2. Drain River workers — let in-progress jobs finish within 30s.
		//    If the deadline expires, Stop cancels remaining jobs.
		slog.Info("draining river workers...")
		drainCtx, drainCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer drainCancel()
		err = riverClient.Stop(drainCtx)
		if err != nil {
			slog.Error("river shutdown error", "error", err)
		}
		slog.Info("river workers drained")

		// 3. Cancel root context for remaining cleanup.
		cancel()
		close(shutdownDone)
	}()

	slog.Info("larafeed starting", "addr", addr, "env", cfg.AppEnv)

	err = httpServer.ListenAndServe()
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}

	// Wait for shutdown goroutine to finish draining before deferred cleanups.
	<-shutdownDone
}

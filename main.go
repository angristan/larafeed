package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/server"
	"github.com/angristan/larafeed-go/internal/worker"
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
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	cfg := config.Load()

	// Connect to database
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database connection failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	srv, svcs, err := server.New(cfg, pool)
	if err != nil {
		slog.Error("failed to create server", "error", err)
		os.Exit(1)
	}

	// Start River worker
	riverClient, err := worker.Setup(ctx, pool, svcs.FeedService, svcs.FaviconService, svcs.Queries)
	if err != nil {
		slog.Error("failed to start worker", "error", err)
		os.Exit(1)
	}

	// Inject River client into OPML handler for async import
	svcs.OPMLHandler.SetRiverClient(riverClient)

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
	riverHandler.Start(ctx)
	srv.Group(func(r chi.Router) {
		r.Use(requireAuthAPI)
		r.Mount("/jobs", riverHandler)
	})

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		slog.Info("shutting down...")

		if err := riverClient.Stop(ctx); err != nil {
			slog.Error("river shutdown error", "error", err)
		}

		cancel()
	}()

	addr := fmt.Sprintf(":%s", cfg.Port)
	slog.Info("larafeed starting", "addr", addr, "env", cfg.AppEnv)

	if err := http.ListenAndServe(addr, srv); err != nil {
		slog.Error("server failed", "error", err)
		os.Exit(1)
	}
}

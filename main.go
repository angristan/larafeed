package main

import (
	"context"
	"fmt"
	"log"
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
		log.Fatalf("Database connection failed: %v", err)
	}
	defer pool.Close()

	srv, svcs, err := server.New(cfg, pool)
	if err != nil {
		log.Fatalf("Failed to create server: %v", err)
	}

	// Start River worker
	riverClient, err := worker.Setup(ctx, pool, svcs.FeedService, svcs.FaviconService, svcs.Queries)
	if err != nil {
		log.Fatalf("Failed to start worker: %v", err)
	}

	// Mount River UI (behind auth)
	endpoints := riverui.NewEndpoints(riverClient, nil)
	riverHandler, err := riverui.NewHandler(&riverui.HandlerOpts{
		Endpoints: endpoints,
		Logger:    slog.Default(),
		Prefix:    "/jobs",
	})
	if err != nil {
		log.Fatalf("Failed to create River UI handler: %v", err)
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
		log.Println("Shutting down...")

		if err := riverClient.Stop(ctx); err != nil {
			log.Printf("River shutdown error: %v", err)
		}

		cancel()
	}()

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("Larafeed starting on %s (env=%s)", addr, cfg.AppEnv)

	if err := http.ListenAndServe(addr, srv); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

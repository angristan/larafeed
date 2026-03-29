package server

import (
	"context"
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/db"
	"github.com/angristan/larafeed-go/internal/handler"
	"github.com/angristan/larafeed-go/internal/handler/api"
	"github.com/angristan/larafeed-go/internal/service"
	"github.com/angristan/larafeed-go/internal/worker"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	gonertia "github.com/romsar/gonertia/v2"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// ViteManifestEntry represents one entry in the Vite build manifest.
type ViteManifestEntry struct {
	File    string   `json:"file"`
	CSS     []string `json:"css"`
	IsEntry bool     `json:"isEntry"`
	Src     string   `json:"src"`
}

func New(ctx context.Context, cfg *config.Config, pool *pgxpool.Pool) (*chi.Mux, *river.Client[pgx.Tx], error) {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return otelhttp.NewHandler(next, "",
			otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string {
				routePattern := chi.RouteContext(r.Context()).RoutePattern()
				if routePattern == "" {
					return r.Method + " " + r.URL.Path
				}
				return r.Method + " " + routePattern
			}),
		)
	})
	r.Use(middleware.RequestID)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))

	// Build the root HTML template with Vite + Ziggy integration
	rootTemplate, err := buildRootTemplate(cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("build root template: %w", err)
	}

	// Create single query instance (needed early for auth middleware)
	q := db.New(pool)

	// Create auth service early (needed for LoadUser middleware and FlashProvider)
	authSvc := auth.New(cfg.SessionKey, q, !cfg.IsDev())
	flashProvider := auth.NewFlashProvider(authSvc.Store(), authSvc.SessionName())

	i, err := gonertia.New(
		rootTemplate,
		gonertia.WithVersion("1"),
		gonertia.WithFlashProvider(flashProvider),
	)
	if err != nil {
		return nil, nil, fmt.Errorf("gonertia init: %w", err)
	}

	// Share auth prop with all Inertia renders.
	// Must use func(context.Context) (any, error) signature to match gonertia's resolvePropVal.
	i.ShareProp("auth", func(ctx context.Context) (any, error) {
		user := auth.UserFromContext(ctx)
		return authProp(user), nil
	})

	// Load user from session into context for ALL routes (before Inertia middleware).
	r.Use(auth.InjectRequestContext) // FlashProvider needs request/writer in context
	r.Use(authSvc.LoadUser)
	r.Use(i.Middleware)

	// Custom 404 handler renders an Inertia error page instead of plain text.
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		handler.RenderError(w, r, i, http.StatusNotFound)
	})

	// Serve static assets
	publicDir := filepath.Join(".", "public")
	fileServer := http.FileServer(http.Dir(publicDir))
	r.Handle("/build/*", fileServer)
	r.Handle("/favicon.ico", fileServer)
	r.Handle("/rss.svg", fileServer)

	// Create remaining services
	filterSvc := service.NewFilterService(q)
	feedSvc := service.NewFeedService(q, pool, filterSvc)
	imgProxySvc, err := service.NewImgProxyService(cfg.ImgProxyURL, cfg.ImgProxyKey, cfg.ImgProxySalt)
	if err != nil {
		return nil, nil, fmt.Errorf("create imgproxy service: %w", err)
	}
	faviconSvc := service.NewFaviconService(q, imgProxySvc)
	llmSvc := service.NewLLMService(cfg.GeminiAPIKey, q)
	telegramSvc := service.NewTelegramService(cfg.TelegramToken, cfg.TelegramChatID)
	opmlSvc := service.NewOPMLService(q, feedSvc)

	// Create remaining services
	readerSvc := service.NewReaderService(q, faviconSvc, imgProxySvc, llmSvc)
	entrySvc := service.NewEntryService(q)
	categorySvc := service.NewCategoryService(q)
	userSvc := service.NewUserService(q, pool)
	subsSvc := service.NewSubscriptionService(q, faviconSvc)
	chartsSvc := service.NewChartsService(q, pool)

	// Start River worker
	riverClient, err := worker.Setup(ctx, pool, feedSvc, faviconSvc, q)
	if err != nil {
		return nil, nil, fmt.Errorf("start river worker: %w", err)
	}

	// Create handlers
	authHandler := handler.NewAuthHandler(i, authSvc, q, cfg, telegramSvc)
	readerHandler := handler.NewReaderHandler(i, readerSvc)
	feedHandler := handler.NewFeedHandler(i, feedSvc, riverClient)
	entryHandler := handler.NewEntryHandler(entrySvc)
	categoryHandler := handler.NewCategoryHandler(i, categorySvc)
	userHandler := handler.NewUserHandler(i, authSvc, userSvc)
	opmlHandler := handler.NewOPMLHandler(i, opmlSvc, authSvc, feedSvc, riverClient)
	subsHandler := handler.NewSubscriptionsHandler(i, subsSvc)
	chartsHandler := handler.NewChartsHandler(i, chartsSvc)

	// API handlers
	greaderHandler := api.NewGoogleReaderHandler(userSvc, readerSvc, entrySvc)
	feverHandler := api.NewFeverHandler(userSvc, readerSvc, entrySvc)

	// Register routes
	RegisterRoutes(r, i, cfg, authSvc, authHandler, readerHandler, feedHandler, entryHandler,
		categoryHandler, userHandler, opmlHandler, subsHandler, chartsHandler,
		greaderHandler, feverHandler)

	return r, riverClient, nil
}

// authProp builds the shared "auth" Inertia prop from a user.
// Only safe fields are included — db.User contains sensitive fields
// (password, tokens, 2FA secrets) that must never be serialized.
func authProp(user *db.User) map[string]any {
	if user == nil {
		return map[string]any{"user": nil}
	}
	return map[string]any{
		"user": map[string]any{
			"id":                user.ID,
			"name":              user.Name,
			"email":             user.Email,
			"email_verified_at": user.EmailVerifiedAt,
		},
	}
}

func buildRootTemplate(cfg *config.Config) (string, error) {
	ziggy := BuildZiggyManifest(cfg.AppURL)
	ziggyJSON, err := json.Marshal(ziggy)
	if err != nil {
		return "", fmt.Errorf("marshal ziggy: %w", err)
	}

	var viteScripts string
	if cfg.IsDev() {
		viteScripts = fmt.Sprintf(`
		<script type="module" src="%s/@vite/client"></script>
		<script type="module">
			import RefreshRuntime from '%s/@react-refresh'
			RefreshRuntime.injectIntoGlobalHook(window)
			window.$RefreshReg$ = () => {}
			window.$RefreshSig$ = () => (type) => type
			window.__vite_plugin_react_preamble_installed__ = true
		</script>
		<script type="module" src="%s/resources/js/app.tsx"></script>`,
			cfg.ViteDev, cfg.ViteDev, cfg.ViteDev)
	} else {
		manifestPath := filepath.Join(".", "public", "build", ".vite", "manifest.json")
		manifestData, err := os.ReadFile(manifestPath)
		if err != nil {
			return "", fmt.Errorf("read vite manifest: %w", err)
		}

		var manifest map[string]ViteManifestEntry
		if err := json.Unmarshal(manifestData, &manifest); err != nil {
			return "", fmt.Errorf("parse vite manifest: %w", err)
		}

		var sb strings.Builder
		for _, entry := range manifest {
			if entry.IsEntry {
				for _, css := range entry.CSS {
					if _, err := fmt.Fprintf(&sb, "<link rel=\"stylesheet\" href=\"/build/%s\">\n", css); err != nil {
						return "", fmt.Errorf("write CSS link: %w", err)
					}
				}
				if _, err := fmt.Fprintf(&sb, "<script type=\"module\" src=\"/build/%s\"></script>\n", entry.File); err != nil {
					return "", fmt.Errorf("write script tag: %w", err)
				}
			}
		}
		viteScripts = sb.String()
	}

	tmpl := fmt.Sprintf(`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>%s</title>
	<script>
		const Ziggy = %s;
	</script>
	%s
	{{ .inertiaHead }}
</head>
<body>
	{{ .inertia }}
</body>
</html>`, cfg.AppName, string(ziggyJSON), viteScripts)

	if _, err := template.New("root").Parse(tmpl); err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	return tmpl, nil
}

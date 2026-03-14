package server

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/angristan/larafeed-go/internal/auth"
	"github.com/angristan/larafeed-go/internal/config"
	"github.com/angristan/larafeed-go/internal/handler"
	"github.com/angristan/larafeed-go/internal/handler/api"
	"github.com/go-chi/chi/v5"
	gonertia "github.com/romsar/gonertia/v2"
)

// ZiggyRoute represents a route in the Ziggy-compatible manifest.
type ZiggyRoute struct {
	URI     string   `json:"uri"`
	Methods []string `json:"methods"`
}

// ZiggyManifest is the full Ziggy route manifest injected into the HTML template.
type ZiggyManifest struct {
	URL      string                `json:"url"`
	Port     *int                  `json:"port"`
	Defaults map[string]string     `json:"defaults"`
	Routes   map[string]ZiggyRoute `json:"routes"`
}

// BuildZiggyManifest creates a Ziggy-compatible route manifest for the frontend.
func BuildZiggyManifest(appURL string) ZiggyManifest {
	return ZiggyManifest{
		URL:      appURL,
		Port:     nil,
		Defaults: map[string]string{},
		Routes: map[string]ZiggyRoute{
			"login":             {URI: "login", Methods: []string{"GET", "HEAD"}},
			"register":          {URI: "register", Methods: []string{"GET", "HEAD"}},
			"password.request":  {URI: "forgot-password", Methods: []string{"GET", "HEAD"}},
			"password.email":    {URI: "forgot-password", Methods: []string{"POST"}},
			"password.reset":    {URI: "reset-password/{token}", Methods: []string{"GET", "HEAD"}},
			"password.store":    {URI: "reset-password", Methods: []string{"POST"}},
			"two-factor.login":  {URI: "two-factor-challenge", Methods: []string{"GET", "HEAD"}},
			"verification.notice": {URI: "verify-email", Methods: []string{"GET", "HEAD"}},
			"verification.verify": {URI: "verify-email/{id}/{hash}", Methods: []string{"GET", "HEAD"}},
			"verification.send":   {URI: "email/verification-notification", Methods: []string{"POST"}},
			"password.confirm":    {URI: "confirm-password", Methods: []string{"GET", "HEAD"}},
			"password.update":     {URI: "password", Methods: []string{"PUT"}},
			"logout":              {URI: "logout", Methods: []string{"POST"}},
			"feeds.index":         {URI: "feeds", Methods: []string{"GET", "HEAD"}},
			"feed.store":          {URI: "feed", Methods: []string{"POST"}},
			"feed.unsubscribe":    {URI: "feed/{feed_id}", Methods: []string{"DELETE"}},
			"feed.refresh":        {URI: "feed/{feed_id}/refresh", Methods: []string{"POST"}},
			"feed.refresh-favicon": {URI: "feed/{feed_id}/refresh-favicon", Methods: []string{"POST"}},
			"feed.update":         {URI: "feed/{feed_id}", Methods: []string{"PATCH"}},
			"feed.mark-read":      {URI: "feed/{feed_id}/mark-read", Methods: []string{"POST"}},
			"entry.update":        {URI: "entry/{entry_id}", Methods: []string{"PATCH"}},
			"category.store":      {URI: "category", Methods: []string{"POST"}},
			"category.delete":     {URI: "category/{category_id}", Methods: []string{"DELETE"}},
			"import.index":        {URI: "import", Methods: []string{"GET", "HEAD"}},
			"import.store":        {URI: "import", Methods: []string{"POST"}},
			"export.download":     {URI: "export", Methods: []string{"GET", "HEAD"}},
			"charts.index":        {URI: "charts", Methods: []string{"GET", "HEAD"}},
			"subscriptions.index": {URI: "subscriptions", Methods: []string{"GET", "HEAD"}},
			"profile.edit":        {URI: "profile", Methods: []string{"GET", "HEAD"}},
			"profile.update":      {URI: "profile", Methods: []string{"PATCH"}},
			"profile.destroy":     {URI: "profile", Methods: []string{"DELETE"}},
			"profile.wipe":        {URI: "profile/wipe", Methods: []string{"POST"}},
		},
	}
}

func RegisterRoutes(
	r chi.Router,
	i *gonertia.Inertia,
	cfg *config.Config,
	authSvc *auth.Auth,
	authHandler *handler.AuthHandler,
	readerHandler *handler.ReaderHandler,
	feedHandler *handler.FeedHandler,
	entryHandler *handler.EntryHandler,
	categoryHandler *handler.CategoryHandler,
	userHandler *handler.UserHandler,
	opmlHandler *handler.OPMLHandler,
	subsHandler *handler.SubscriptionsHandler,
	chartsHandler *handler.ChartsHandler,
	greaderHandler *api.GoogleReaderHandler,
	feverHandler *api.FeverHandler,
) {
	// Welcome page
	r.Get("/", func(w http.ResponseWriter, r *http.Request) {
		// If authenticated, redirect to feeds
		user := auth.UserFromRequest(r)
		if user != nil {
			http.Redirect(w, r, "/feeds", http.StatusFound)
			return
		}
		if err := i.Render(w, r, "Welcome", gonertia.Props{
			"canRegister": cfg.RegistrationEnabled,
		}); err != nil {
			slog.Error("render error", "component", "Welcome", "error", err)
			handler.RenderError(w, r, i, http.StatusInternalServerError)
		}
	})

	// Guest routes (login, register, etc.)
	r.Group(func(r chi.Router) {
		r.Use(authSvc.RequireGuest)

		r.Get("/login", authHandler.ShowLogin)
		r.Post("/login", authHandler.Login)
		r.Get("/register", authHandler.ShowRegister)
		r.Post("/register", authHandler.Register)
		r.Get("/forgot-password", authHandler.ShowForgotPassword)
		r.Post("/forgot-password", authHandler.ForgotPassword)
		r.Get("/reset-password/{token}", authHandler.ShowResetPassword)
		r.Post("/reset-password", authHandler.ResetPassword)
		r.Get("/two-factor-challenge", authHandler.ShowTwoFactorChallenge)
		r.Post("/two-factor-challenge", authHandler.TwoFactorChallenge)
	})

	// Authenticated routes
	r.Group(func(r chi.Router) {
		r.Use(authSvc.RequireAuth)

		// Reader
		r.Get("/feeds", readerHandler.Show)

		// Feed CRUD (rate limited: 10 per minute)
		r.With(RateLimitByIP(10, 1*time.Minute)).Post("/feed", feedHandler.Create)
		r.Delete("/feed/{feed_id}", feedHandler.Unsubscribe)
		r.Post("/feed/{feed_id}/refresh", feedHandler.Refresh)
		r.Post("/feed/{feed_id}/refresh-favicon", feedHandler.RefreshFavicon)
		r.Patch("/feed/{feed_id}", feedHandler.Update)
		r.Post("/feed/{feed_id}/mark-read", feedHandler.MarkRead)

		// Entry interactions
		r.Patch("/entry/{entry_id}", entryHandler.Update)

		// Categories
		r.Post("/category", categoryHandler.Create)
		r.Delete("/category/{category_id}", categoryHandler.Delete)

		// OPML
		r.Get("/import", opmlHandler.ShowImport)
		r.Post("/import", opmlHandler.Import)
		r.Get("/export", opmlHandler.Export)

		// Charts & subscriptions
		r.Get("/charts", chartsHandler.Show)
		r.Get("/subscriptions", subsHandler.Show)

		// User settings
		r.Get("/profile", userHandler.ShowSettings)
		r.Patch("/profile", userHandler.UpdateProfile)
		r.Delete("/profile", userHandler.DeleteAccount)
		r.Post("/profile/wipe", userHandler.WipeAccount)

		// Password
		r.Put("/password", authHandler.UpdatePassword)

		// Email verification (rate limited: 6 per minute)
		r.Get("/verify-email", authHandler.ShowVerifyEmail)
		r.Get("/verify-email/{id}/{hash}", authHandler.VerifyEmail)
		r.With(RateLimitByIP(6, 1*time.Minute)).Post("/email/verification-notification", authHandler.SendVerificationEmail)

		// Password confirmation
		r.Get("/confirm-password", authHandler.ShowConfirmPassword)
		r.Post("/confirm-password", authHandler.ConfirmPassword)

		// Logout
		r.Post("/logout", authHandler.Logout)
	})

	// API routes
	r.Route("/api", func(r chi.Router) {
		// Authenticated user endpoint (Sanctum-like)
		r.With(authSvc.RequireAuth).Get("/user", func(w http.ResponseWriter, r *http.Request) {
			user := auth.UserFromRequest(r)
			if user == nil {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]any{
				"id":    user.ID,
				"name":  user.Name,
				"email": user.Email,
			})
		})

		// Google Reader API
		r.Post("/reader/accounts/ClientLogin", greaderHandler.ClientLogin)
		r.Route("/reader/reader/api/0", func(r chi.Router) {
			r.Use(greaderHandler.CheckToken)
			r.Get("/user-info", greaderHandler.GetUserInfo)
			r.Get("/token", greaderHandler.GetToken)
			r.Get("/subscription/list", greaderHandler.GetSubscriptionList)
			r.Get("/stream/items/ids", greaderHandler.GetStreamItemIds)
			r.Post("/stream/items/contents", greaderHandler.GetStreamContents)
			r.Post("/edit-tag", greaderHandler.EditTag)
		})

		// Fever API
		r.Route("/fever", func(r chi.Router) {
			r.Use(feverHandler.CheckToken)
			r.Get("/", feverHandler.Handle)
			r.Post("/", feverHandler.Handle)
		})
	})
}

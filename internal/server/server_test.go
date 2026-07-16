package server

import (
	"strings"
	"testing"

	"github.com/angristan/larafeed-go/internal/config"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildRootTemplateBootstrapsColorSchemeBeforeFrontend(t *testing.T) {
	tmpl, err := buildRootTemplate(&config.Config{
		AppName: "Larafeed",
		AppURL:  "http://localhost:3000",
		AppEnv:  "development",
		ViteDev: "http://localhost:5173",
	})
	require.NoError(t, err)

	colorSchemeScript := strings.Index(tmpl, "data-mantine-script")
	frontendScript := strings.Index(tmpl, "/build/resources/js/app.tsx")

	assert.Contains(t, tmpl, `<meta name="color-scheme" content="light dark">`)
	assert.Contains(t, tmpl, `mantine-color-scheme-value`)
	assert.GreaterOrEqual(t, colorSchemeScript, 0)
	assert.Greater(t, frontendScript, colorSchemeScript)
}

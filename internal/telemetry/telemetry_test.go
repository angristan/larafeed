package telemetry

import (
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/sdk/resource"
)

func TestAppResourceMergesWithDifferentSchemaURL(t *testing.T) {
	defaultResource := resource.NewWithAttributes(
		"https://opentelemetry.io/schemas/1.41.0",
		attribute.String("service.name", "default-service"),
	)

	res, err := resource.Merge(defaultResource, appResource("larafeed", "production"))

	require.NoError(t, err)
	require.Equal(t, "https://opentelemetry.io/schemas/1.41.0", res.SchemaURL())

	attrs := resourceAttributes(res)
	require.Equal(t, "larafeed", attrs["service.name"])
	require.Equal(t, "production", attrs["deployment.environment.name"])
}

func resourceAttributes(res *resource.Resource) map[string]string {
	attrs := make(map[string]string, res.Len())
	iter := res.Iter()
	for iter.Next() {
		attr := iter.Attribute()
		attrs[string(attr.Key)] = attr.Value.AsString()
	}
	return attrs
}

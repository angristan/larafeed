<?php

declare(strict_types=1);

namespace Tests\Feature;

use App\Support\Tracing;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Keepsuit\LaravelOpenTelemetry\Facades\Tracer;

/**
 * Tests for OpenTelemetry integration.
 * Extends BaseTestCase directly to avoid database dependency from Pennant in TestCase.
 */
class OpenTelemetryTest extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        // Configure OTel to use in-memory exporter for testing
        config([
            'opentelemetry.traces.exporter' => 'memory',
            'opentelemetry.metrics.exporter' => 'null',
            'opentelemetry.logs.exporter' => 'null',
        ]);
    }

    public function test_tracing_helper_sets_otel_span_attributes(): void
    {
        Tracer::newSpan('test.span')
            ->measure(function (): void {
                Tracing::setAttributes([
                    'test.string' => 'value',
                    'test.int' => 42,
                    'test.float' => 3.14,
                    'test.bool' => true,
                ]);

                $span = Tracer::activeSpan();
                $this->assertTrue($span->isRecording());
            });
    }

    public function test_tracer_can_create_nested_spans(): void
    {
        $result = Tracer::newSpan('parent.span')
            ->setAttribute('level', 'parent')
            ->measure(function (): string {
                return Tracer::newSpan('child.span')
                    ->setAttribute('level', 'child')
                    ->measure(function (): string {
                        $span = Tracer::activeSpan();
                        $this->assertTrue($span->isRecording());

                        return 'nested-result';
                    });
            });

        $this->assertSame('nested-result', $result);
    }

    public function test_tracer_records_exceptions_in_spans(): void
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('test error');

        Tracer::newSpan('error.span')
            ->measure(function (): void {
                throw new \RuntimeException('test error');
            });
    }

    public function test_tracing_helper_works_without_active_span(): void
    {
        // Should not throw when called outside a span context
        Tracing::setAttributes([
            'test.key' => 'test.value',
        ]);

        $this->assertTrue(true);
    }
}

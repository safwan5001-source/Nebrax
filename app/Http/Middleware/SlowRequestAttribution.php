<?php

namespace App\Http\Middleware;

use App\Support\SlowRequestMetrics;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Throwable;

/** Records an allowlisted summary only for slow Laravel-controlled API requests. */
class SlowRequestAttribution
{
    public const METRICS_ATTRIBUTE = 'awj.performance.slow_request_metrics';

    public function handle(Request $request, Closure $next): Response
    {
        $metrics = new SlowRequestMetrics();
        $request->attributes->set(self::METRICS_ATTRIBUTE, $metrics);
        $startedAt = hrtime(true);
        $response = null;
        $exception = null;

        try {
            $response = $next($request);

            return $response;
        } catch (Throwable $caught) {
            $exception = $caught;

            throw $caught;
        } finally {
            $durationMs = (hrtime(true) - $startedAt) / 1_000_000;

            try {
                if ($durationMs > $this->thresholdMs()) {
                    Log::warning('awj.performance.slow_request', [
                        'event' => 'awj.performance.slow_request',
                        'method' => $request->method(),
                        // Laravel route pattern; never a raw URL/query string.
                        'route' => $request->route()?->uri(),
                        'status' => $response?->getStatusCode() ?? $this->statusFor($exception),
                        'duration_ms' => round($durationMs, 2),
                        'db_duration_ms' => round($metrics->databaseDurationMs(), 2),
                        'db_query_count' => $metrics->queryCount(),
                    ]);
                }
            } catch (Throwable) {
                // Observability must never fail an ERP request.
            } finally {
                $request->attributes->remove(self::METRICS_ATTRIBUTE);
            }
        }
    }

    private function thresholdMs(): int
    {
        return max(0, (int) config('performance.slow_request_ms', 500));
    }

    private function statusFor(?Throwable $exception): int
    {
        return $exception instanceof HttpExceptionInterface ? $exception->getStatusCode() : 500;
    }
}

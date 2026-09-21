<?php

namespace Tests\Feature;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;
use Tests\TestCase;

class SlowRequestAttributionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        Route::prefix('api')->middleware('api')->group(function (): void {
            Route::get('__perf6b/observed', function (Request $request) {
                DB::select('select ? as marker', [$request->query('business_reference')]);

                return response()->json(['data' => ['ok' => true]]);
            });

            Route::post('__perf6b/echo', function (Request $request) {
                DB::select('select ? as marker', [$request->input('customer_note')]);

                return response()->json(['data' => $request->input('customer_note')]);
            });

            Route::get('__perf6b/no-query', fn () => response()->json(['data' => ['ok' => true]]));
            Route::get('__perf6b/denied', fn () => abort(403));
        });
    }

    /** @test */
    public function a_request_below_the_threshold_does_not_emit_a_slow_request_event(): void
    {
        config(['performance.slow_request_ms' => 60000]);
        Log::spy();

        $this->getJson('/api/__perf6b/observed?business_reference=private-reference')->assertOk();

        Log::shouldNotHaveReceived('warning');
    }

    /** @test */
    public function a_slow_request_logs_an_allowlisted_normalized_summary_without_sensitive_request_or_query_data(): void
    {
        config(['performance.slow_request_ms' => 0]);
        $event = null;
        $context = null;

        Log::shouldReceive('warning')->once()->withArgs(function (string $name, array $data) use (&$event, &$context): bool {
            $event = $name;
            $context = $data;

            return true;
        });

        $this->withHeader('Authorization', 'Bearer should-never-appear')
            ->withCookie('session_secret', 'should-never-appear')
            ->postJson('/api/__perf6b/echo?customer_id=should-never-appear', [
                'customer_note' => 'should-never-appear',
                'password' => 'should-never-appear',
            ])
            ->assertOk()
            ->assertJsonPath('data', 'should-never-appear');

        $this->assertSame('awj.performance.slow_request', $event);
        $this->assertSame([
            'event', 'method', 'route', 'status', 'duration_ms', 'db_duration_ms', 'db_query_count',
        ], array_keys($context));
        $this->assertSame('POST', $context['method']);
        $this->assertSame('api/__perf6b/echo', $context['route']);
        $this->assertSame(200, $context['status']);
        $this->assertGreaterThanOrEqual(0, $context['duration_ms']);
        $this->assertGreaterThanOrEqual(0, $context['db_duration_ms']);
        $this->assertSame(1, $context['db_query_count']);
        $this->assertStringNotContainsString('should-never-appear', json_encode($context, JSON_THROW_ON_ERROR));
    }

    /** @test */
    public function query_metrics_are_request_scoped_and_a_single_listener_does_not_double_count_queries(): void
    {
        config(['performance.slow_request_ms' => 0]);
        $contexts = [];

        Log::shouldReceive('warning')->twice()->withArgs(function (string $name, array $data) use (&$contexts): bool {
            $this->assertSame('awj.performance.slow_request', $name);
            $contexts[] = $data;

            return true;
        });

        $this->getJson('/api/__perf6b/observed?business_reference=first')->assertOk();
        $this->getJson('/api/__perf6b/no-query')->assertOk();

        $this->assertCount(2, $contexts);
        $this->assertSame(1, $contexts[0]['db_query_count']);
        $this->assertSame(0, $contexts[1]['db_query_count']);
        $this->assertSame('api/__perf6b/no-query', $contexts[1]['route']);
    }

    /** @test */
    public function an_error_response_keeps_its_status_and_is_observed_without_changing_the_response(): void
    {
        config(['performance.slow_request_ms' => 0]);
        $context = null;

        Log::shouldReceive('warning')->once()->withArgs(function (string $name, array $data) use (&$context): bool {
            $this->assertSame('awj.performance.slow_request', $name);
            $context = $data;

            return true;
        });

        $this->getJson('/api/__perf6b/denied')->assertForbidden();

        $this->assertSame(403, $context['status']);
        $this->assertSame('api/__perf6b/denied', $context['route']);
    }
}

<?php

namespace Tests\Feature;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceFacetVisual;
use App\Models\StorefrontMedia;
use App\Models\Tenant;
use App\Services\Commerce\CommerceFacetVisualException;
use App\Services\Commerce\CommerceFacetVisualService;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-VD-H1 / VD-1b — real PostgreSQL concurrency (D-16, D-17)
 * ═══════════════════════════════════════════════════════════════
 *  Two real OS processes (`pcntl_fork()`), each with its own PostgreSQL connection (`DB::purge()` right after the
 *  fork) — the method of `ProductVariantPostgresConcurrencyTest`. Production code on both sides; a model event
 *  inside the holder's transaction keeps its row lock for a moment so the other process provably waits on it.
 *
 *  - Two creates of the same identity: one wins, the other is a 409 (never a raw unique-violation 500).
 *  - Delete holds the media lock while a save arrives: the save waits, then sees the deletion → 422 media_not_found.
 *  - Save holds the media lock while a delete arrives: the delete waits, then re-scans → 409 media_in_use.
 *
 *  Skipped unless the engine is `pgsql` and `pcntl` is available (CI runs it in the pgsql matrix).
 */
class CommerceFacetVisualPostgresConcurrencyTest extends TestCase
{
    private Tenant $tenant;

    private CommerceFacet $facet;

    private CommerceFacetValue $value;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً — SQLite يسلسل الكتابات فلا يُظهر انتظار الأقفال.');
        }
        if (! function_exists('pcntl_fork')) {
            $this->markTestSkipped('امتداد pcntl غير متاح في هذه البيئة.');
        }

        $this->tenant = Tenant::create([
            'name' => 'نبراس تزامن الهوية', 'slug' => 'vis-concurrency-'.uniqid(),
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->facet = CommerceFacet::create(['key' => 'occasion', 'name' => 'المناسبة']);
        $this->value = CommerceFacetValue::create(['commerce_facet_id' => $this->facet->id, 'slug' => 'birthday', 'name' => 'عيد ميلاد']);
    }

    protected function tearDown(): void
    {
        if (isset($this->tenant)) {
            DB::table('commerce_facet_visuals')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('commerce_facet_values')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('commerce_facets')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('storefront_media')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('branches')->where('tenant_id', $this->tenant->id)->delete();
            DB::table('tenants')->where('id', $this->tenant->id)->delete();
        }

        parent::tearDown();
    }

    private function committedMedia(): string
    {
        return StorefrontMedia::create([
            'kind' => 'image', 'original_name' => 'cake.png', 'mime' => 'image/png', 'size' => 1234,
            'sha256' => hash('sha256', Str::uuid()->toString()), 'width' => 800, 'height' => 800,
            'storage_key' => Str::random(20), 'variants_state' => StorefrontMedia::VARIANTS_READY,
            'state' => StorefrontMedia::STATE_ACTIVE,
        ])->id;
    }

    /**
     * @param  list<array{delay: float, job: callable(): mixed}>  $jobs  delay in seconds after the shared start
     * @return list<array{ok: bool, value?: mixed, error_class?: string, code?: string, errors?: array<string, list<string>>, message?: string, elapsed: float}>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = tempnam(sys_get_temp_dir(), 'vis_barrier_');
        unlink($barrier);
        $resultFiles = [];
        $pids = [];

        foreach ($jobs as $i => ['delay' => $delay, 'job' => $job]) {
            $resultFiles[$i] = tempnam(sys_get_temp_dir(), 'vis_result_');
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork — لا يمكن إثبات تزامن حقيقي بدونه.');
            }

            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 5.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                usleep((int) ($delay * 1_000_000));
                $started = microtime(true);
                try {
                    $value = $job();
                    $out = ['ok' => true, 'value' => $value];
                } catch (\Throwable $e) {
                    $out = [
                        'ok' => false,
                        'error_class' => get_class($e),
                        'code' => property_exists($e, 'errorCode') ? $e->errorCode : null,
                        'errors' => property_exists($e, 'errors') ? $e->errors : null,
                        'message' => $e->getMessage(),
                    ];
                }
                file_put_contents($resultFiles[$i], json_encode($out + ['elapsed' => microtime(true) - $started]));
                exit(0);
            }
            $pids[] = $pid;
        }

        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        @unlink($barrier);

        $results = [];
        foreach ($resultFiles as $i => $file) {
            $raw = file_get_contents($file);
            @unlink($file);
            $results[$i] = json_decode($raw !== false && $raw !== '' ? $raw : '{"ok":false,"message":"no output","elapsed":0}', true);
        }

        return $results;
    }

    /** @test */
    public function two_concurrent_creates_of_the_same_identity_leave_one_row_and_a_409(): void
    {
        $tenantId = $this->tenant->id;
        $facetId = $this->facet->id;
        $valueId = $this->value->id;
        $create = fn (string $icon) => function () use ($tenantId, $facetId, $valueId, $icon) {
            app(TenantContext::class)->set($tenantId);
            // Hold the transaction open after the insert, so the other create meets the unique index on a live row.
            CommerceFacetVisual::created(static fn () => usleep(800_000));

            return app(CommerceFacetVisualService::class)->saveForValue($facetId, $valueId, ['icon' => $icon], null);
        };

        $results = $this->runConcurrently([
            ['delay' => 0.0, 'job' => $create('cake')],
            ['delay' => 0.0, 'job' => $create('gift')],
        ]);

        $outcomes = array_map(static fn (array $r) => $r['ok'] ? 'created' : ($r['code'] ?? $r['error_class']), $results);
        sort($outcomes);
        $this->assertSame(['created', 'visual_version_conflict'], $outcomes, json_encode($results));
        $this->assertSame(1, CommerceFacetVisual::query()->where('commerce_facet_value_id', $valueId)->count());
    }

    /** @test */
    public function a_save_that_arrives_while_a_delete_holds_the_media_lock_waits_and_sees_the_deletion(): void
    {
        $tenantId = $this->tenant->id;
        $mediaId = $this->committedMedia();
        $facetId = $this->facet->id;
        $valueId = $this->value->id;

        $results = $this->runConcurrently([
            ['delay' => 0.0, 'job' => function () use ($tenantId, $mediaId) {
                app(TenantContext::class)->set($tenantId);
                // Inside delete()'s transaction, after the soft delete: keep the media row locked.
                StorefrontMedia::saved(static fn () => usleep(1_500_000));
                app(StorefrontMediaService::class)->delete(StorefrontMedia::find($mediaId));

                return 'deleted';
            }],
            ['delay' => 0.4, 'job' => function () use ($tenantId, $facetId, $valueId, $mediaId) {
                app(TenantContext::class)->set($tenantId);

                return app(CommerceFacetVisualService::class)->saveForValue($facetId, $valueId, ['image' => ['mediaId' => $mediaId]], null);
            }],
        ]);

        $this->assertSame('deleted', $results[0]['value'] ?? null, json_encode($results));
        $this->assertFalse($results[1]['ok'], json_encode($results));
        $this->assertSame(CommerceFacetVisualException::class, $results[1]['error_class']);
        $this->assertSame(['visual.image.mediaId' => ['media_not_found']], $results[1]['errors']);
        $this->assertGreaterThan(0.7, $results[1]['elapsed'], 'the save must have waited on the media lock');
        $this->assertSame(0, CommerceFacetVisual::query()->count());
        $this->assertSame(StorefrontMedia::STATE_DELETED, StorefrontMedia::find($mediaId)->state);
    }

    /** @test */
    public function a_delete_that_arrives_while_a_save_holds_the_media_lock_waits_and_refuses(): void
    {
        $tenantId = $this->tenant->id;
        $mediaId = $this->committedMedia();
        $facetId = $this->facet->id;
        $valueId = $this->value->id;

        $results = $this->runConcurrently([
            ['delay' => 0.0, 'job' => function () use ($tenantId, $facetId, $valueId, $mediaId) {
                app(TenantContext::class)->set($tenantId);
                // Inside the save's transaction, after the visual row is written: keep the media row locked.
                CommerceFacetVisual::created(static fn () => usleep(1_500_000));

                return app(CommerceFacetVisualService::class)->saveForValue($facetId, $valueId, ['image' => ['mediaId' => $mediaId]], null);
            }],
            ['delay' => 0.4, 'job' => function () use ($tenantId, $mediaId) {
                app(TenantContext::class)->set($tenantId);
                app(StorefrontMediaService::class)->delete(StorefrontMedia::find($mediaId));

                return 'deleted';
            }],
        ]);

        $this->assertTrue($results[0]['ok'], json_encode($results));
        $this->assertSame(1, $results[0]['value']['version']);
        $this->assertFalse($results[1]['ok'], json_encode($results));
        $this->assertSame(StorefrontMediaException::class, $results[1]['error_class']);
        $this->assertSame('media_in_use', $results[1]['code']);
        $this->assertGreaterThan(0.7, $results[1]['elapsed'], 'the delete must have waited on the media lock');
        $this->assertSame(StorefrontMedia::STATE_ACTIVE, StorefrontMedia::find($mediaId)->state);
    }
}

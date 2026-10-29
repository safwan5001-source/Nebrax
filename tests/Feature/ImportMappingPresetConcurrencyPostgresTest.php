<?php

namespace Tests\Feature;

use App\Models\ImportMappingPreset;
use App\Models\Tenant;
use App\Services\ImportMappingPresetService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * IMP-H8-S2a — حفظ مطابقات الأعمدة تحت **تزامن حقيقي** (PostgreSQL + عمليات `pcntl_fork` حقيقية): الاسم المطبَّع فريد والسقف لكل مجال لا يُتجاوز، والخاسر يتلقّى رفضاً
 * بالرسالة المعتادة (RuntimeException ⇒ 422) لا خطأ تفرّد من القاعدة. القفل الاستشاري لكل (مؤسسة، مجال) يسلسل الفحص والإدراج.
 * على SQLite يُتجاهل؛ على PostgreSQL غياب pcntl **فشل لا تخطٍّ**. تشغيل: php artisan test --filter=ImportMappingPresetConcurrencyPostgresTest
 */
class ImportMappingPresetConcurrencyPostgresTest extends TestCase
{
    private Tenant $tenant;

    private string $dir;

    protected function setUp(): void
    {
        parent::setUp();
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('يتطلب PostgreSQL حقيقياً.');
        }
        $this->assertTrue(function_exists('pcntl_fork'), 'pcntl مطلوب لاختبارات تزامن PostgreSQL؛ غيابه فشل لا تخطٍّ.');

        $this->dir = sys_get_temp_dir().'/mapping_presets_'.uniqid();
        mkdir($this->dir);
        $this->tenant = Tenant::create(['name' => 'نبراس presets', 'slug' => 'presets-'.uniqid(), 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($this->tenant->id);
        app(BranchContext::class)->forget();
    }

    protected function tearDown(): void
    {
        if (isset($this->dir) && is_dir($this->dir)) {
            foreach (glob($this->dir.'/*') ?: [] as $f) {
                @unlink($f);
            }
            @rmdir($this->dir);
        }
        if (DB::connection()->getDriverName() === 'pgsql' && isset($this->tenant)) {
            try {
                DB::table('import_mapping_presets')->where('tenant_id', $this->tenant->id)->delete();
                DB::table('tenants')->where('id', $this->tenant->id)->delete();
            } catch (QueryException) {
            }
        }
        parent::tearDown();
    }

    /**
     * @param  list<callable(): mixed>  $jobs
     * @return list<array<string, mixed>>
     */
    private function runConcurrently(array $jobs): array
    {
        $barrier = $this->dir.'/barrier';
        $files = [];
        $pids = [];
        foreach ($jobs as $i => $job) {
            $files[$i] = $this->dir."/result_{$i}";
            $pid = pcntl_fork();
            if ($pid === -1) {
                $this->fail('فشل pcntl_fork.');
            }
            if ($pid === 0) {
                DB::purge(config('database.default'));
                $deadline = microtime(true) + 10.0;
                while (! file_exists($barrier) && microtime(true) < $deadline) {
                    usleep(500);
                }
                try {
                    file_put_contents($files[$i], json_encode(['ok' => true, 'value' => $job()]));
                } catch (\Throwable $e) {
                    file_put_contents($files[$i], json_encode(['ok' => false, 'error_class' => get_class($e), 'message' => $e->getMessage()]));
                }
                exit(0);
            }
            $pids[] = $pid;
        }
        touch($barrier);
        foreach ($pids as $pid) {
            pcntl_waitpid($pid, $status);
        }
        $results = [];
        foreach ($files as $i => $file) {
            $results[$i] = json_decode(is_file($file) ? (string) file_get_contents($file) : '{"ok":false,"message":"no output"}', true);
        }

        return $results;
    }

    private function creator(string $name): callable
    {
        $tenantId = $this->tenant->id;

        return function () use ($tenantId, $name) {
            app(TenantContext::class)->set($tenantId);
            app(BranchContext::class)->forget();

            return app(ImportMappingPresetService::class)->create('stock_permit_import', $name, [['header' => 'sku', 'field' => 'sku']], null)->id;
        };
    }

    private function presetCount(): int
    {
        return (int) DB::table('import_mapping_presets')->where('tenant_id', $this->tenant->id)->count();
    }

    /** @test */
    public function racing_saves_of_one_normalised_name_create_exactly_one_preset_and_the_losers_get_the_normal_refusal(): void
    {
        // ست كتابات مختلفة للاسم نفسه بعد التطبيع (ألف/همزة، مسافات، شرطة)
        $results = $this->runConcurrently(array_map(fn (string $name) => $this->creator($name), ['مورد أ', 'مورد ا', ' مورد  أ', 'مورد-أ', 'مورد إ', 'مورد آ']));

        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));
        foreach (array_filter($results, fn ($r) => ! $r['ok']) as $loser) {
            $this->assertSame(\RuntimeException::class, $loser['error_class'], 'الخاسر يتلقّى رفضاً بالرسالة المعتادة لا خطأ قاعدة: '.($loser['message'] ?? ''));
        }
        $this->assertSame(1, $this->presetCount());
    }

    /** @test */
    public function racing_saves_never_exceed_the_per_domain_limit(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $service = app(ImportMappingPresetService::class);
        for ($i = 1; $i <= ImportMappingPresetService::MAX_PER_DOMAIN - 1; $i++) {
            $service->create('stock_permit_import', "seed{$i}", [['header' => 'sku', 'field' => 'sku']], null);
        }

        $results = $this->runConcurrently(array_map(fn (int $n) => $this->creator("racer{$n}"), range(1, 12)));

        $this->assertSame(1, count(array_filter($results, fn ($r) => $r['ok'])), json_encode($results, JSON_UNESCAPED_UNICODE));
        foreach (array_filter($results, fn ($r) => ! $r['ok']) as $loser) {
            $this->assertSame(\RuntimeException::class, $loser['error_class'], $loser['message'] ?? '');
        }
        $this->assertSame(ImportMappingPresetService::MAX_PER_DOMAIN, $this->presetCount());
        $this->assertSame(ImportMappingPresetService::MAX_PER_DOMAIN, ImportMappingPreset::query()->where('domain', 'stock_permit_import')->count());
    }
}

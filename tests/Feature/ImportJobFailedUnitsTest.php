<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Models\Product;
use App\Support\ImportUnitRef;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * IMP-H1-S8a — الوحدات الفاشلة لتشغيلة الاستيراد الدائم وملف الصفوف الفاشلة.
 *
 * ملف من 250 صفاً بصفٍّ فاسد في الترتيب 149: القطعة الأولى (0–99) تُرحَّل، والثانية (100–199) تفشل وتتراجع كاملةً، فتبقى
 * 150 وحدة غير منجزة: واحدة فاسدة بعينها، و99 تراجعت مع نافذتها، و50 لم تُعالَج بعد. كلها قابلة للإصلاح (S8b) ومعرّفها ثابت.
 */
class ImportJobFailedUnitsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BAD_ORDINAL = 149;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function csv(int $rows = 250, ?int $badOrdinal = self::BAD_ORDINAL): UploadedFile
    {
        $lines = ['sku,name,type,sale_price,purchase_price'];
        for ($i = 0; $i < $rows; $i++) {
            $type = $i === $badOrdinal ? 'نوع_غير_معروف' : 'good';
            $lines[] = sprintf('FU-%03d,منتج %d,%s,10.00,4.00', $i, $i, $type);
        }

        return UploadedFile::fake()->createWithContent('big.csv', implode("\n", $lines)."\n");
    }

    /** @return array{0: array<string, mixed>, 1: string} [auth, jobId] بعد ترحيل القطع حتى الفشل أو الاكتمال */
    private function failedJob(?int $badOrdinal = self::BAD_ORDINAL): array
    {
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->csv(250, $badOrdinal),
        ], ['Accept' => 'application/json'])->assertCreated()['data']['id'];

        for ($i = 0; $i < 5; $i++) {
            $response = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create']);
            if ($response->status() !== 200 || $response['data']['status'] === 'completed') {
                break;
            }
        }

        return [$auth, $id];
    }

    /** @return array<int, array<int, string>> */
    private function csvRows(TestResponse $response): array
    {
        $response->assertOk();
        $file = $response->baseResponse->getFile();
        $path = tempnam(sys_get_temp_dir(), 'failures-');
        copy($file->getPathname(), $path);
        $rows = SpreadsheetReader::read($path, 'csv', 5000, 200);
        @unlink($path);

        return $rows;
    }

    /** @test */
    public function a_failed_chunk_records_the_culprit_the_rolled_back_window_and_the_unattempted_tail(): void
    {
        [$auth, $id] = $this->failedJob();

        $job = ImportJob::query()->whereKey($id)->firstOrFail();
        $this->assertSame('failed', $job->status);
        $this->assertSame(100, (int) $job->processed_rows, 'القطعة الأولى رُحِّلت والثانية تراجعت.');
        $this->assertSame(100, Product::query()->count());

        $units = ImportJobUnit::query()->where('import_job_id', $id)->orderBy('unit_ordinal')->get();
        $this->assertCount(150, $units);
        $this->assertSame(100, $units->first()->unit_ordinal);
        $this->assertSame(249, $units->last()->unit_ordinal);

        $byCode = $units->groupBy('error_code')->map->count()->sortKeys()->all();
        $this->assertSame(['not_attempted' => 50, 'row_invalid' => 1, 'window_rolled_back' => 99], $byCode);
        $this->assertSame(self::BAD_ORDINAL, $units->firstWhere('error_code', 'row_invalid')->unit_ordinal);
        $this->assertNotSame('', (string) $units->firstWhere('error_code', 'row_invalid')->error_message);
        $this->assertSame(['failed'], $units->pluck('status')->unique()->values()->all());

        $this->withToken($auth['token'])->getJson("/api/import-jobs/{$id}")->assertOk()->assertJsonPath('data.failed_units', 150);
    }

    /** @test */
    public function unit_refs_are_deterministic_unique_and_independent_of_business_keys(): void
    {
        [, $id] = $this->failedJob();

        $units = ImportJobUnit::query()->where('import_job_id', $id)->get();
        $this->assertCount(150, $units->pluck('source_unit_ref')->unique());
        foreach ($units as $unit) {
            $this->assertSame(ImportUnitRef::for($id, $unit->unit_ordinal), $unit->source_unit_ref);
        }
        $this->assertNotSame(ImportUnitRef::for($id, 1), ImportUnitRef::for((string) \Illuminate\Support\Str::uuid(), 1), 'التشغيلات المختلفة بمعرّفات مختلفة.');
    }

    /** @test */
    public function a_fully_successful_job_records_no_units(): void
    {
        [, $id] = $this->failedJob(null);

        $this->assertSame('completed', ImportJob::query()->whereKey($id)->value('status'));
        $this->assertSame(0, ImportJobUnit::query()->where('import_job_id', $id)->count());
    }

    /** @test */
    public function the_failures_file_carries_original_values_the_stable_ref_and_the_error(): void
    {
        [$auth, $id] = $this->failedJob();

        $rows = $this->csvRows($this->withToken($auth['token'])->get("/api/import-jobs/{$id}/failures?format=csv"));
        $header = $rows[0];
        $this->assertSame(['_awj_unit_ref', '_awj_error_code', '_awj_error', '_awj_redacted'], array_slice($header, -4));
        $this->assertSame(['sku', 'name', 'type', 'sale_price', 'purchase_price'], array_slice($header, 0, 5));
        $this->assertCount(151, $rows, 'ترويسة + 150 وحدة.');

        $first = $rows[1];
        $this->assertSame('FU-100', $first[0]);
        $this->assertSame(ImportUnitRef::for($id, 100), $first[5]);
        $this->assertSame('window_rolled_back', $first[6]);
        $this->assertSame('4.00', $first[4], 'المخوَّل بالتكلفة يرى قيمتها الأصلية.');

        $bad = collect($rows)->first(fn ($r) => ($r[6] ?? null) === 'row_invalid');
        $this->assertSame('FU-149', $bad[0]);
        $this->assertSame('نوع_غير_معروف', $bad[2], 'القيمة الفاسدة الأصلية كما هي لتُصحَّح.');
    }

    /** @test */
    public function cost_columns_are_blanked_and_named_for_a_manager_without_the_cost_permission(): void
    {
        [$auth, $id] = $this->failedJob();

        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'imp-manager', 'permissions' => ['products.view', 'products.manage'],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'm', 'email' => 'm-fu@t.test', 'password' => 'password123', 'role' => $role['slug'],
        ])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'm-fu@t.test', 'password' => 'password123'])->assertOk()['token'];

        $rows = $this->csvRows($this->withToken($token)->get("/api/import-jobs/{$id}/failures?format=csv"));
        $this->assertSame('', $rows[1][4], 'سعر الشراء محجوب.');
        $this->assertSame('10.00', $rows[1][3], 'سعر البيع ليس تكلفة فيبقى.');
        $this->assertSame('purchase_price', $rows[1][8], 'العمود المحجوب مسمّى.');
        $this->assertStringNotContainsString('4.00', implode(',', $rows[1]));
    }

    /** @test */
    public function the_failures_file_requires_manage_permission_and_is_tenant_isolated(): void
    {
        [$auth, $id] = $this->failedJob();

        $viewRole = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'imp-viewer', 'permissions' => ['products.view'],
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'v', 'email' => 'v-fu@t.test', 'password' => 'password123', 'role' => $viewRole['slug'],
        ])->assertCreated();
        $viewer = $this->postJson('/api/login', ['email' => 'v-fu@t.test', 'password' => 'password123'])->assertOk()['token'];
        $this->withToken($viewer)->getJson("/api/import-jobs/{$id}/failures")->assertForbidden();

        app(TenantContext::class)->forget();
        $other = $this->registerTenant('other-fu', 'other-fu@t.test');
        $this->withToken($other['token'])->getJson("/api/import-jobs/{$id}/failures")->assertNotFound();
    }

    /** @test */
    public function a_job_without_failed_units_has_nothing_to_download(): void
    {
        [$auth, $id] = $this->failedJob(null);

        $this->withToken($auth['token'])->getJson("/api/import-jobs/{$id}/failures")->assertStatus(422);
    }

    /** @test */
    public function atomic_file_domains_record_no_units_and_offer_no_failures_file(): void
    {
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'inventory_opening', 'file' => UploadedFile::fake()->createWithContent('open.csv', "sku,quantity,unit_cost\nX,1,1\n"),
        ], ['Accept' => 'application/json']);
        if ($id->status() === 201) {
            $jobId = $id['data']['id'];
            $this->assertSame(0, ImportJobUnit::query()->where('import_job_id', $jobId)->count());
            $this->withToken($auth['token'])->getJson("/api/import-jobs/{$jobId}/failures")->assertStatus(422);
        } else {
            $this->markTestSkipped('لا تشغيلة inventory_opening في هذا الإعداد.');
        }
    }
}

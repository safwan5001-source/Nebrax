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
        $created = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'inventory_opening', 'file' => UploadedFile::fake()->createWithContent('open.csv', "sku,quantity,unit_cost\nX,1,1\n"),
        ], ['Accept' => 'application/json'])->assertCreated();
        $jobId = $created['data']['id'];

        $this->assertSame(0, ImportJobUnit::query()->where('import_job_id', $jobId)->count());
        $this->withToken($auth['token'])->getJson("/api/import-jobs/{$jobId}/failures")->assertStatus(422);
    }

    /** @test */
    public function blank_rows_do_not_shift_the_ordinal_of_the_failing_unit(): void
    {
        $lines = ['sku,name,type,sale_price,purchase_price', ',,,,'];
        $ordinal = 0;
        for ($i = 0; $i < 130; $i++) {
            if ($i % 7 === 0) {
                $lines[] = ',,,,';
            }
            $type = $i === 120 ? 'نوع_غير_معروف' : 'good';
            $lines[] = sprintf('BL-%03d,منتج %d,%s,10.00,4.00', $i, $i, $type);
            $ordinal++;
        }
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => UploadedFile::fake()->createWithContent('blank.csv', implode("\n", $lines)."\n"),
        ], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        for ($n = 0; $n < 4; $n++) {
            if ($this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create'])->status() !== 200) {
                break;
            }
        }

        $this->assertSame('failed', ImportJob::query()->whereKey($id)->value('status'));
        $bad = ImportJobUnit::query()->where('import_job_id', $id)->where('error_code', 'row_invalid')->firstOrFail();
        $this->assertSame(120, $bad->unit_ordinal, 'الترتيب بين صفوف البيانات الفعلية لا الأسطر الفيزيائية.');

        $rows = $this->csvRows($this->withToken($auth['token'])->get("/api/import-jobs/{$id}/failures?format=csv"));
        $row = collect($rows)->first(fn ($r) => ($r[6] ?? null) === 'row_invalid');
        $this->assertSame('BL-120', $row[0], 'الملف يعيد الصف الفاسد نفسه رغم الأسطر الفارغة.');
        $this->assertSame(ImportUnitRef::for($id, 120), $row[5]);
    }

    /** @test */
    public function a_failure_in_the_first_chunk_records_the_whole_file_as_unapplied(): void
    {
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->csv(250, 5),
        ], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create'])->assertStatus(422);

        $this->assertSame(0, Product::query()->count());
        $this->assertSame(250, ImportJobUnit::query()->where('import_job_id', $id)->count());
        $this->assertSame(0, ImportJobUnit::query()->where('import_job_id', $id)->min('unit_ordinal'));
    }

    /** @test */
    public function the_failures_file_can_be_downloaded_as_xlsx(): void
    {
        [$auth, $id] = $this->failedJob();

        $response = $this->withToken($auth['token'])->get("/api/import-jobs/{$id}/failures?format=xlsx")->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'failures-x-');
        copy($response->baseResponse->getFile()->getPathname(), $path);
        $rows = SpreadsheetReader::read($path, 'xlsx', 5000, 200);
        @unlink($path);

        $this->assertCount(151, $rows);
        $this->assertSame('_awj_unit_ref', $rows[0][5]);
        $this->assertSame(ImportUnitRef::for($id, 100), $rows[1][5]);
    }

    /** @test */
    public function a_cost_like_column_left_unmapped_is_still_redacted_for_a_user_without_cost_permission(): void
    {
        $auth = $this->registerTenant();
        $lines = ['sku,name,type,sale_price,Unit Cost'];
        for ($i = 0; $i < 3; $i++) {
            $lines[] = sprintf('UC-%d,منتج %d,%s,10.00,7.77', $i, $i, $i === 1 ? 'نوع_غير_معروف' : 'good');
        }
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => UploadedFile::fake()->createWithContent('uc.csv', implode("\n", $lines)."\n"),
        ], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create'])->assertStatus(422);

        $role = $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'uc-mgr', 'permissions' => ['products.view', 'products.manage']])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson('/api/users', ['name' => 'u', 'email' => 'uc@t.test', 'password' => 'password123', 'role' => $role['slug']])->assertCreated();
        $token = $this->postJson('/api/login', ['email' => 'uc@t.test', 'password' => 'password123'])->assertOk()['token'];

        $manager = $this->csvRows($this->withToken($token)->get("/api/import-jobs/{$id}/failures?format=csv"));
        $this->assertStringNotContainsString('7.77', json_encode($manager));
        $owner = $this->csvRows($this->withToken($auth['token'])->get("/api/import-jobs/{$id}/failures?format=csv"));
        $this->assertStringContainsString('7.77', json_encode($owner), 'المخوَّل يرى القيمة.');
    }

    /** @test */
    public function a_database_error_message_is_never_stored_on_a_unit(): void
    {
        [, $id] = $this->failedJob();
        ImportJobUnit::query()->where('import_job_id', $id)->delete();
        $job = ImportJob::query()->whereKey($id)->firstOrFail();
        $e = new \Illuminate\Database\QueryException('pgsql', 'insert into products (purchase_price) values (?)', [4.00], new \PDOException('SQLSTATE[23505]'));

        app(\App\Services\ImportJobUnitRecorder::class)->recordChunkFailure($job, app(\App\Services\ImportDomainRegistry::class)->for('product_catalog'), 100, 100, $e);

        $message = (string) ImportJobUnit::query()->where('import_job_id', $id)->where('unit_ordinal', 100)->value('error_message');
        $this->assertStringNotContainsString('purchase_price', $message);
        $this->assertStringNotContainsString('insert', $message);
        $this->assertSame('chunk_failed', ImportJobUnit::query()->where('import_job_id', $id)->where('unit_ordinal', 100)->value('error_code'));
    }

    /** @test */
    public function a_failure_after_the_rows_were_written_rolls_the_whole_chunk_back(): void
    {
        // محوّلٌ يكتب الصفوف فعلاً ثم يفشل بعد ذلك (كفشل مرحلة صور المنتجات بعد كتابة المنتجات).
        $this->app->bind(\App\Services\ProductCatalogImportAdapter::class, fn () => new class extends \App\Services\ProductCatalogImportAdapter {
            public function applyChunk(\App\Support\ImportChunk $chunk): \App\Support\ImportChunkResult
            {
                parent::applyChunk($chunk);
                throw new \RuntimeException('late failure after the rows were written');
            }
        });
        $this->app->forgetInstance(\App\Services\ImportDomainRegistry::class);

        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'product_catalog', 'file' => $this->csv(120, null),
        ], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create'])->assertStatus(422);

        $this->assertSame('failed', ImportJob::query()->whereKey($id)->value('status'));
        $this->assertSame(0, Product::query()->count(), 'الصفوف التي كُتبت قبل فشل مرحلة الصور تراجعت مع نافذتها.');
        $this->assertSame(0, (int) ImportJob::query()->whereKey($id)->value('processed_rows'));
        $this->assertSame(120, ImportJobUnit::query()->where('import_job_id', $id)->count());
    }
}

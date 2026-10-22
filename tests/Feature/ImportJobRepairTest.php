<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Models\Product;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * IMP-H1-S8b — تشغيلة إصلاح فرعية من ملفٍّ مصحَّح: العضوية بمعرّف المصدر، والمطالبة الذرّية وحدةً وحدة عند الترحيل.
 */
class ImportJobRepairTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BAD = 149;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function csv(int $rows = 250, ?int $bad = self::BAD): UploadedFile
    {
        $lines = ['sku,name,type,sale_price,purchase_price'];
        for ($i = 0; $i < $rows; $i++) {
            $lines[] = sprintf('RP-%03d,منتج %d,%s,10.00,4.00', $i, $i, $i === $bad ? 'نوع_غير_معروف' : 'good');
        }

        return UploadedFile::fake()->createWithContent('rp.csv', implode("\n", $lines)."\n");
    }

    /** @return array{0: array<string, mixed>, 1: string} */
    private function failedParent(int $rows = 250, ?int $bad = self::BAD): array
    {
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $this->csv($rows, $bad)], ['Accept' => 'application/json'])
            ->assertCreated()['data']['id'];
        for ($i = 0; $i < 6; $i++) {
            if ($this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create'])->status() !== 200) {
                break;
            }
        }

        return [$auth, $id];
    }

    /** @return array<int, array<int, string>> */
    private function downloadRows(array $auth, string $id): array
    {
        $response = $this->withToken($auth['token'])->get("/api/import-jobs/{$id}/failures")->assertOk();
        $tmp = tempnam(sys_get_temp_dir(), 'rp-dl-');
        copy($response->baseResponse->getFile()->getPathname(), $tmp);
        $rows = SpreadsheetReader::read($tmp, 'xlsx', 5000, 200);
        @unlink($tmp);

        return $rows;
    }

    /** @param array<int, array<int, string>> $rows */
    private function xlsxFile(array $rows, string $name = 'fixed.xlsx'): UploadedFile
    {
        $tmp = tempnam(sys_get_temp_dir(), 'rp-up-').'.xlsx';
        SpreadsheetWriter::xlsx($tmp, $rows[0], array_slice($rows, 1), array_fill(0, count($rows[0]), SpreadsheetWriter::TYPE_TEXT));

        return new UploadedFile($tmp, $name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
    }

    /** يصحّح الصف الفاسد (النوع) في ملف الفشل المنزَّل. */
    private function correctedRows(array $auth, string $id): array
    {
        $rows = $this->downloadRows($auth, $id);
        foreach ($rows as $i => $row) {
            if ($i > 0 && ($row[6] ?? '') === 'row_invalid') {
                $rows[$i][2] = 'good';
            }
        }

        return $rows;
    }

    private function repair(array $auth, string $id, UploadedFile $file, array $extra = []): TestResponse
    {
        return $this->withToken($auth['token'])->post("/api/import-jobs/{$id}/repairs", array_merge(['file' => $file], $extra), ['Accept' => 'application/json']);
    }

    private function applyAll(array $auth, string $id): TestResponse
    {
        $last = null;
        for ($i = 0; $i < 6; $i++) {
            $last = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create']);
            if ($last->status() !== 200 || $last['data']['status'] === 'completed') {
                break;
            }
        }

        return $last;
    }

    /** @test */
    public function a_corrected_failures_file_repairs_exactly_the_failed_units_through_a_child_job(): void
    {
        [$auth, $parent] = $this->failedParent();
        $this->assertSame(100, Product::query()->count());

        $child = $this->repair($auth, $parent, $this->xlsxFile($this->correctedRows($auth, $parent)))->assertCreated();
        $this->assertSame($parent, $child['data']['parent_job_id']);
        $childId = $child['data']['id'];
        $this->assertSame(150, $child['data']['row_count']);

        $this->applyAll($auth, $childId)->assertOk()->assertJsonPath('data.status', 'completed');

        $this->assertSame(250, Product::query()->count(), 'الناجحة لم تُكرَّر والفاشلة طُبِّقت.');
        $units = ImportJobUnit::query()->where('import_job_id', $parent)->get();
        $this->assertSame(['repaired'], $units->pluck('status')->unique()->values()->all());
        $this->assertSame([$childId], $units->pluck('repaired_by_job_id')->unique()->values()->all());
        $this->withToken($auth['token'])->getJson("/api/import-jobs/{$parent}")->assertJsonPath('data.failed_units', 0);
    }

    /** @test */
    public function a_child_that_fails_again_claims_nothing_so_the_units_stay_repairable(): void
    {
        [$auth, $parent] = $this->failedParent();
        $uncorrected = $this->downloadRows($auth, $parent);

        $childId = $this->repair($auth, $parent, $this->xlsxFile($uncorrected))->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$childId}/apply", ['mode' => 'create'])->assertStatus(422);

        $this->assertSame('failed', ImportJob::query()->whereKey($childId)->value('status'));
        $this->assertSame(150, ImportJobUnit::query()->where('import_job_id', $parent)->where('status', 'failed')->count(), 'المطالبة تراجعت مع نافذتها.');
        $this->assertNull(ImportJobUnit::query()->where('import_job_id', $parent)->value('repaired_by_job_id'));
        $this->assertSame(100, Product::query()->count());

        // ثم يُصلَح فعلاً بتشغيلة فرعية ثانية.
        $second = $this->repair($auth, $parent, $this->xlsxFile($this->correctedRows($auth, $parent)))->assertCreated()['data']['id'];
        $this->applyAll($auth, $second)->assertJsonPath('data.status', 'completed');
        $this->assertSame(250, Product::query()->count());
    }

    /** @test */
    public function two_children_over_the_same_units_repair_each_unit_once(): void
    {
        [$auth, $parent] = $this->failedParent();
        $fixed = $this->correctedRows($auth, $parent);

        $a = $this->repair($auth, $parent, $this->xlsxFile($fixed, 'a.xlsx'))->assertCreated()['data']['id'];
        $b = $this->repair($auth, $parent, $this->xlsxFile($fixed, 'b.xlsx'))->assertCreated()['data']['id'];

        $this->applyAll($auth, $a)->assertJsonPath('data.status', 'completed');
        $this->withToken($auth['token'])->postJson("/api/import-jobs/{$b}/apply", ['mode' => 'create'])->assertStatus(422);

        $this->assertSame(250, Product::query()->count(), 'لا تكرار: الطفل الثاني لم يكتب شيئاً.');
        $this->assertSame([$a], ImportJobUnit::query()->where('import_job_id', $parent)->pluck('repaired_by_job_id')->unique()->values()->all());
        $this->assertSame('failed', ImportJob::query()->whereKey($b)->value('status'));
        $this->assertSame('repair_ref_already_used', ImportJobUnit::query()->where('import_job_id', $b)->value('error_code'));
    }

    /** @test */
    public function membership_is_validated_by_ref_before_any_job_is_created(): void
    {
        [$auth, $parent] = $this->failedParent();
        $good = $this->correctedRows($auth, $parent);
        $before = ImportJob::query()->count();

        $unknown = $good;
        $unknown[1][5] = (string) \Illuminate\Support\Str::uuid();
        $this->repair($auth, $parent, $this->xlsxFile($unknown))->assertStatus(422)->assertJsonPath('code', 'repair_ref_unknown');

        $dup = $good;
        $dup[2][5] = $dup[1][5];
        $this->repair($auth, $parent, $this->xlsxFile($dup))->assertStatus(422)->assertJsonPath('code', 'repair_ref_duplicate');

        $missing = $good;
        $missing[1][5] = '';
        $this->repair($auth, $parent, $this->xlsxFile($missing))->assertStatus(422)->assertJsonPath('code', 'repair_ref_missing');

        $noColumn = array_map(fn ($r) => array_slice($r, 0, 5), $good);
        $this->repair($auth, $parent, $this->xlsxFile($noColumn))->assertStatus(422)->assertJsonPath('code', 'repair_ref_missing');

        $this->assertSame($before, ImportJob::query()->count(), 'لا تشغيلة تُنشأ عند الرفض.');

        // وحدة أُصلحت سابقاً ليست قابلة للإصلاح ثانية.
        $first = $this->repair($auth, $parent, $this->xlsxFile($good))->assertCreated()['data']['id'];
        $this->applyAll($auth, $first)->assertJsonPath('data.status', 'completed');
        $this->repair($auth, $parent, $this->xlsxFile($good, 'again.xlsx'))->assertStatus(422)->assertJsonPath('code', 'repair_ref_not_failed');
    }

    /** @test */
    public function only_a_failed_job_can_be_repaired_and_only_by_a_manager_in_the_same_tenant(): void
    {
        [$auth, $parent] = $this->failedParent();
        $fixed = $this->correctedRows($auth, $parent);

        $ok = $this->withToken($auth['token'])->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => UploadedFile::fake()->createWithContent('ok.csv', "sku,name,type,sale_price\nOK-1,منتج,good,10.00\n")], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        $this->applyAll($auth, $ok)->assertJsonPath('data.status', 'completed');
        $this->repair($auth, $ok, $this->xlsxFile($fixed))->assertStatus(422)->assertJsonPath('code', 'repair_not_available');

        $role = $this->withToken($auth['token'])->postJson('/api/roles', ['name' => 'rp-viewer', 'permissions' => ['products.view']])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson('/api/users', ['name' => 'v', 'email' => 'rp-v@t.test', 'password' => 'password123', 'role' => $role['slug']])->assertCreated();
        $viewer = $this->postJson('/api/login', ['email' => 'rp-v@t.test', 'password' => 'password123'])->assertOk()['token'];
        $this->withToken($viewer)->post("/api/import-jobs/{$parent}/repairs", ['file' => $this->xlsxFile($fixed)], ['Accept' => 'application/json'])->assertForbidden();

        app(TenantContext::class)->forget();
        $other = $this->registerTenant('rp-other', 'rp-other@t.test');
        $this->repair($other, $parent, $this->xlsxFile($fixed))->assertNotFound();
    }

    /** @test */
    public function a_csv_with_a_writer_quote_prefix_is_refused_not_imported_corrupted(): void
    {
        [$auth, $parent] = $this->failedParent();
        $rows = $this->correctedRows($auth, $parent);
        $rows[1][0] = "'-A1";

        $lines = array_map(fn ($r) => implode(',', array_map(fn ($c) => str_contains((string) $c, ',') ? '"'.$c.'"' : $c, $r)), $rows);
        $csv = UploadedFile::fake()->createWithContent('fixed.csv', implode("\n", $lines)."\n");

        $this->repair($auth, $parent, $csv)->assertStatus(422)->assertJsonPath('code', 'repair_csv_quote_prefix');
    }

    /** @test */
    public function atomic_file_domains_cannot_be_repaired_partially(): void
    {
        $auth = $this->registerTenant();
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', [
            'domain' => 'inventory_opening', 'file' => UploadedFile::fake()->createWithContent('o.csv', "sku,quantity,unit_cost\nX,1,1\n"),
        ], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        ImportJob::query()->whereKey($id)->update(['status' => 'failed']);

        $rows = [['sku', '_awj_unit_ref'], ['X', (string) \Illuminate\Support\Str::uuid()]];
        $this->repair($auth, $id, $this->xlsxFile($rows))->assertStatus(422)->assertJsonPath('code', 'repair_domain_unsupported');
    }

    /** @test */
    public function a_malformed_ref_is_an_unknown_ref_not_a_server_error(): void
    {
        [$auth, $parent] = $this->failedParent();
        $rows = $this->correctedRows($auth, $parent);
        $rows[1][5] = 'abc';

        $this->repair($auth, $parent, $this->xlsxFile($rows))->assertStatus(422)->assertJsonPath('code', 'repair_ref_unknown');
    }

    /** @test */
    public function a_lost_response_retry_with_the_same_key_returns_the_same_child_even_after_it_was_applied(): void
    {
        [$auth, $parent] = $this->failedParent();
        $fixed = $this->correctedRows($auth, $parent);

        // إعادة المحاولة الحقيقية ترسل **البايتات نفسها** (بصمة الملف جزء من هوية الطلب)؛ XLSX المبنيّ من جديد يحمل طابع زمن ZIP قد يختلف بين الثانيتين.
        $file = $this->xlsxFile($fixed);
        $same = fn () => new UploadedFile($file->getPathname(), 'fixed.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);

        $first = $this->repair($auth, $parent, $same(), ['idempotency_key' => 'rp-key-1'])->assertCreated()['data']['id'];
        $this->applyAll($auth, $first)->assertJsonPath('data.status', 'completed');

        $retry = $this->repair($auth, $parent, $same(), ['idempotency_key' => 'rp-key-1'])->assertOk();
        $this->assertSame($first, $retry['data']['id']);
        $this->assertSame(250, Product::query()->count());
    }

    /** @test */
    public function blank_rows_in_the_repair_file_do_not_misalign_the_claims(): void
    {
        [$auth, $parent] = $this->failedParent();
        $rows = $this->correctedRows($auth, $parent);
        array_splice($rows, 3, 0, [array_fill(0, count($rows[0]), '')]);
        array_splice($rows, 60, 0, [array_fill(0, count($rows[0]), '')]);

        $child = $this->repair($auth, $parent, $this->xlsxFile($rows))->assertCreated()['data']['id'];
        $this->applyAll($auth, $child)->assertJsonPath('data.status', 'completed');

        $this->assertSame(250, Product::query()->count());
        $this->assertSame(0, ImportJobUnit::query()->where('import_job_id', $parent)->where('status', 'failed')->count());
    }

    /** @test */
    public function prune_keeps_a_failed_parent_that_still_has_an_unfinished_repair_child(): void
    {
        [$auth, $parent] = $this->failedParent();
        $child = $this->repair($auth, $parent, $this->xlsxFile($this->correctedRows($auth, $parent)))->assertCreated()['data']['id'];
        ImportJob::query()->whereKey($parent)->update(['purge_after' => now()->subDay()]);

        $this->artisan('imports:prune')->assertSuccessful();
        $this->assertTrue(ImportJob::query()->whereKey($parent)->exists(), 'الأم محفوظة ما دام طفلها لم ينتهِ.');

        $this->applyAll($auth, $child)->assertJsonPath('data.status', 'completed');
        $this->artisan('imports:prune')->assertSuccessful();
        $this->assertFalse(ImportJob::query()->whereKey($parent)->exists(), 'بعد انتهاء الطفل تُقلَّم كسائر المنتهيات.');
    }
}

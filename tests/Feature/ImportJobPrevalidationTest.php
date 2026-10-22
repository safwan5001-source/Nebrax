<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\ImportJobUnit;
use App\Models\Product;
use App\Support\ImportUnitRef;
use App\Support\SpreadsheetReader;
use App\Support\SpreadsheetWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * IMP-H1-S5 — فحص الملف كله قبل أول قطعة: تكرارٌ عبر النوافذ لا يُرحِّل شيئاً ثم يفشل متأخراً.
 *
 * النافذة ١٠٠ صف: صفٌّ مكرَّر بين نافذتين كان يمرّ بفحص نافذته (`$seen` محلّي) ويُرحَّل ما قبله، ثم يفشل عند الكتابة.
 */
class ImportJobPrevalidationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    /** @param array<int, string> $overrideSku ترتيب الصف => SKU */
    private function csv(int $rows, array $overrideSku = [], string $barcodeColumn = ''): UploadedFile
    {
        $lines = ['sku,name,type,sale_price'.($barcodeColumn !== '' ? ',barcode' : '')];
        for ($i = 0; $i < $rows; $i++) {
            $sku = $overrideSku[$i] ?? sprintf('PV-%03d', $i);
            $lines[] = "{$sku},منتج {$i},good,10.00".($barcodeColumn !== '' ? ','.($i === 5 || $i === 160 ? $barcodeColumn : '') : '');
        }

        return UploadedFile::fake()->createWithContent('pv.csv', implode("\n", $lines)."\n");
    }

    private function runJob(array $auth, UploadedFile $file): array
    {
        $id = $this->withToken($auth['token'])->post('/api/import-jobs', ['domain' => 'product_catalog', 'file' => $file], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        $last = null;
        for ($i = 0; $i < 6; $i++) {
            $last = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$id}/apply", ['mode' => 'create']);
            if ($last->status() !== 200 || $last['data']['status'] === 'completed') {
                break;
            }
        }

        return [$id, $last];
    }

    /** @test */
    public function a_duplicate_sku_across_windows_fails_before_anything_is_written(): void
    {
        $auth = $this->registerTenant();

        [$id, $response] = $this->runJob($auth, $this->csv(250, [160 => 'PV-010']));

        $response->assertStatus(422);
        $this->assertSame(0, Product::query()->count(), 'لا نافذة رُحِّلت قبل اكتشاف التكرار.');
        $this->assertSame('failed', ImportJob::query()->whereKey($id)->value('status'));
        $this->assertSame(0, (int) ImportJob::query()->whereKey($id)->value('processed_rows'));

        $units = ImportJobUnit::query()->where('import_job_id', $id)->get();
        $this->assertCount(250, $units, 'كل الوحدات غير مطبَّقة وقابلة للإصلاح.');
        $named = $units->where('error_code', 'row_duplicate_in_file');
        $this->assertSame([160], $named->pluck('unit_ordinal')->all(), 'تُسمّى النسخة المكرَّرة (الظهور الثاني) ولو وقعت خارج النافذة الأولى.');
        $this->assertStringContainsString('أول ظهور في الصف 12', (string) $named->first()->error_message);
    }

    /** @test */
    public function the_duplicate_check_is_case_insensitive_and_covers_barcodes(): void
    {
        $auth = $this->registerTenant();

        [, $caseResponse] = $this->runJob($auth, $this->csv(250, [5 => 'ab-1', 200 => 'AB-1']));
        $caseResponse->assertStatus(422);
        $this->assertSame(0, Product::query()->count());

        [, $barcodeResponse] = $this->runJob($auth, $this->csv(250, [], '6281234567890'));
        $barcodeResponse->assertStatus(422);
        $this->assertSame(0, Product::query()->count());
    }

    /** @test */
    public function a_clean_file_is_unaffected_and_a_corrected_repair_succeeds(): void
    {
        $auth = $this->registerTenant();
        [$clean, $ok] = $this->runJob($auth, $this->csv(250));
        $ok->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(250, Product::query()->where('sku', 'like', 'PV-%')->count());
        $this->assertSame(0, ImportJobUnit::query()->where('import_job_id', $clean)->count());
    }

    /** @test */
    public function the_corrected_file_repairs_a_cross_window_duplicate_through_a_child_job(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->runJob($auth, $this->csv(250, [160 => 'PV-010']));

        $response = $this->withToken($auth['token'])->get("/api/import-jobs/{$id}/failures")->assertOk();
        $tmp = tempnam(sys_get_temp_dir(), 'pv-dl-');
        copy($response->baseResponse->getFile()->getPathname(), $tmp);
        $rows = SpreadsheetReader::read($tmp, 'xlsx', 5000, 200);
        @unlink($tmp);
        $this->assertCount(251, $rows);
        foreach ($rows as $i => $row) {
            if ($i > 0 && ($row[4] ?? '') === ImportUnitRef::for($id, 160)) {
                $rows[$i][0] = 'PV-FIXED';
            }
        }
        $out = tempnam(sys_get_temp_dir(), 'pv-up-').'.xlsx';
        SpreadsheetWriter::xlsx($out, $rows[0], array_slice($rows, 1), array_fill(0, count($rows[0]), SpreadsheetWriter::TYPE_TEXT));
        $file = new UploadedFile($out, 'fixed.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);

        $child = $this->withToken($auth['token'])->post("/api/import-jobs/{$id}/repairs", ['file' => $file], ['Accept' => 'application/json'])->assertCreated()['data']['id'];
        for ($i = 0; $i < 6; $i++) {
            $r = $this->withToken($auth['token'])->postJson("/api/import-jobs/{$child}/apply", []);
            if ($r->status() !== 200 || $r['data']['status'] === 'completed') {
                break;
            }
        }

        $this->assertSame('completed', ImportJob::query()->whereKey($child)->value('status'));
        $this->assertSame(250, Product::query()->count());
        $this->assertTrue(Product::query()->where('sku', 'PV-FIXED')->exists());
    }
}

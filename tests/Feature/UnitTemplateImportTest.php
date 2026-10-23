<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\Product;
use App\Models\UnitTemplate;
use App\Models\UnitTemplateUnit;
use App\Services\UnitTemplateImportAdapter;
use App\Services\UnitTemplateImportService;
use App\Support\ImportChunk;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetWriter;
use App\Support\UnitTemplateImportFields;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-H4-S3 — استيراد قوالب الوحدات (إنشاء فقط، بلا ذكاء اصطناعي — D-08): العقد، التجميع، قواعد المتحكّم، السياسة، الذرّية، والمحوّل (غير مسجَّل بعد).
 *
 * تشغيل: php artisan test --filter=UnitTemplateImportTest
 */
class UnitTemplateImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $tenantId;

    private string $token;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        $this->token = $auth['token'];
        app(TenantContext::class)->set($this->tenantId);
    }

    private function service(): UnitTemplateImportService
    {
        return app(UnitTemplateImportService::class);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('templates.csv', SpreadsheetWriter::csv($keys, $table));
    }

    /** @return list<string> */
    private function actions(array $preview): array
    {
        return array_map(fn (array $row): string => (string) $row['action'], $preview['rows']);
    }

    private function row(string $template, string $base, string $unit = '', string $factor = '', string $active = ''): array
    {
        return ['template_name' => $template, 'base_unit' => $base, 'unit_name' => $unit, 'factor' => $factor, 'is_active' => $active];
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contract_maps_arabic_headers_and_has_no_product_or_update_fields(): void
    {
        foreach (['product_id', 'nebrax_id', 'tenant_id', 'template_id', 'sale_price'] as $forbidden) {
            $this->assertNotContains($forbidden, UnitTemplateImportFields::keys(), $forbidden);
        }
        $map = UnitTemplateImportFields::autoMap(['اسم القالب', 'وحدة الأساس', 'الوحدة البديلة', 'المعامل', 'نشط', 'عمود غريب']);
        $this->assertSame(['template_name', 'base_unit', 'unit_name', 'factor', 'is_active', null], array_values($map));
    }

    /** @test */
    public function the_template_is_importable_as_is(): void
    {
        $preview = $this->service()->preview(UploadedFile::fake()->createWithContent('t.csv', $this->service()->template()), []);

        $this->assertSame([0, 3, 3], [$preview['error_rows'], $preview['create_templates'], $preview['create_units']]);
    }

    /** @test */
    public function unknown_options_and_incomplete_mappings_are_refused(): void
    {
        $file = $this->file([$this->row('ق', 'قطعة', 'كرتون', '12')]);
        foreach ([['existing_policy' => 'overwrite'], ['mapping' => [0 => 'product_id']]] as $options) {
            try {
                $this->service()->preview($file, $options);
                $this->fail('كان يجب الرفض: '.json_encode($options));
            } catch (\RuntimeException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
        foreach ([
            "template_name,unit_name,factor\nق,كرتون,12\n",                 // بلا وحدة أساس
            "template_name,base_unit,unit_name\nق,قطعة,كرتون\n",             // وحدة بلا معامل
        ] as $csv) {
            try {
                $this->service()->preview(UploadedFile::fake()->createWithContent('m.csv', $csv), []);
                $this->fail('كان يجب رفض الخريطة.');
            } catch (\RuntimeException $e) {
                $this->assertNotSame('', $e->getMessage());
            }
        }
    }

    // ═══════════════════════════════ الإنشاء ═══════════════════════════════

    /** @test */
    public function templates_are_created_with_their_alternate_units_in_one_transaction(): void
    {
        $rows = [
            $this->row('كرتون/قطعة', 'قطعة', 'كرتون', '12', 'نعم'),
            $this->row('كرتون/قطعة', 'قطعة', 'دزينة', '12'),
            $this->row('وزن', 'كيلو', 'طن', '1000', 'لا'),
            $this->row('قطعة فقط', 'قطعة'),
        ];
        $preview = $this->service()->preview($this->file($rows), []);
        $this->assertSame([3, 3, 4], [$preview['create_templates'], $preview['create_units'], $preview['total_rows']]);

        $result = $this->service()->apply($this->file($rows), []);

        $this->assertSame([3, 3, 0, 0], [$result['created'], $result['created_units'], $result['skipped'], $result['updated']]);
        $box = UnitTemplate::query()->where('name', 'كرتون/قطعة')->first();
        $this->assertSame(['قطعة', true, ['دزينة' => 12, 'كرتون' => 12]], [$box->base_unit, $box->is_active, $box->units()->orderBy('name')->pluck('factor', 'name')->all()]);
        $this->assertFalse(UnitTemplate::query()->where('name', 'وزن')->first()->is_active);
        $this->assertSame(0, UnitTemplate::query()->where('name', 'قطعة فقط')->first()->units()->count());
    }

    /** @test */
    public function the_created_template_resolves_units_exactly_like_one_made_through_the_screen(): void
    {
        $this->service()->apply($this->file([$this->row('كرتون', 'قطعة', 'كرتون', '12')]), []);
        $template = UnitTemplate::query()->with('units')->first();

        $this->assertSame([1, 12, null], [$template->factorFor('قطعة'), $template->factorFor('كرتون'), $template->factorFor('طن')]);
    }

    /** @test */
    public function rows_of_a_template_need_not_be_adjacent(): void
    {
        $rows = [$this->row('أ', 'قطعة', 'كرتون', '12'), $this->row('ب', 'كيلو', 'طن', '1000'), $this->row('أ', 'قطعة', 'دزينة', '12')];

        $result = $this->service()->apply($this->file($rows), []);

        $this->assertSame([2, 3], [$result['created'], $result['created_units']]);
        $this->assertSame(2, UnitTemplateUnit::query()->whereHas('template', fn ($q) => $q->where('name', 'أ'))->count());
    }

    // ═══════════════════════════════ قواعد المتحكّم ═══════════════════════════════

    /** @test */
    public function the_controllers_unit_rules_are_enforced_per_row(): void
    {
        $rows = [
            $this->row('أ', 'قطعة', 'قطعة', '12'),                 // وحدة بديلة باسم الأساس
            $this->row('ب', 'قطعة', 'كرتون', '1'),                 // معامل 1
            $this->row('ج', 'قطعة', 'كرتون', '1000001'),           // فوق السقف
            $this->row('د', 'قطعة', 'كرتون', 'abc'),               // ليس عدداً
            $this->row('ه', 'قطعة', 'كرتون', '12'),
            $this->row('ه', 'قطعة', 'كرتون', '24'),                // وحدة مكررة
            $this->row('و', 'قطعة', 'كرتون', '12'),
            $this->row('و', 'علبة', 'دزينة', '12'),                // وحدة أساس متعارضة
            $this->row('ز', 'قطعة', '', '12'),                     // معامل بلا وحدة
            $this->row('ح', 'قطعة', 'كرتون', '12', 'ربما'),        // حالة غير صالحة
            $this->row('ط', 'قطعة', 'كرتون', '12', 'نعم'),
            $this->row('ط', 'قطعة', 'دزينة', '12', 'لا'),          // حالة متعارضة
        ];
        $preview = $this->service()->preview($this->file($rows), []);

        $this->assertSame(['error', 'error', 'error', 'error', 'create', 'error', 'create', 'error', 'error', 'error', 'create', 'error'], $this->actions($preview));
        $this->assertStringContainsString('وحدة الأساس', $preview['errors'][0]['messages'][0]);
        $this->assertStringContainsString('المعامل', $preview['errors'][2]['messages'][0]);
        $this->assertStringContainsString('مكرّرة', $preview['errors'][4]['messages'][0]);
        $this->assertStringContainsString('تخالف', $preview['errors'][5]['messages'][0]);
        $this->assertSame(0, UnitTemplate::query()->count());
    }

    /** @test */
    public function more_than_fifty_alternate_units_are_refused(): void
    {
        $rows = array_map(fn (int $n): array => $this->row('كبير', 'قطعة', "وحدة {$n}", (string) (1 + $n)), range(1, 51));

        $preview = $this->service()->preview($this->file($rows), []);

        $this->assertSame(1, $preview['error_rows']);
        $this->assertStringContainsString('الحد الأقصى', $preview['errors'][0]['messages'][0]);
    }

    /** @test */
    public function an_error_anywhere_writes_nothing(): void
    {
        $rows = [$this->row('سليم', 'قطعة', 'كرتون', '12'), $this->row('سيئ', 'قطعة', 'كرتون', '1')];

        try {
            $this->service()->apply($this->file($rows), []);
            $this->fail('كان يجب الفشل.');
        } catch (ImportUnitFailureException $e) {
            $this->assertSame([1], array_column($e->failures, 'ordinal'));
        }
        $this->assertSame(0, UnitTemplate::query()->count());
    }

    /** @test */
    public function a_failure_in_the_middle_of_writing_rolls_everything_back(): void
    {
        UnitTemplate::creating(function (UnitTemplate $template): void {
            if ($template->name === 'ينفجر') {
                throw new \RuntimeException('فشل كتابة مُحقَن');
            }
        });

        try {
            $this->service()->apply($this->file([$this->row('أول', 'قطعة', 'كرتون', '12'), $this->row('ينفجر', 'قطعة')]), []);
            $this->fail('كان يجب أن يفشل.');
        } catch (\RuntimeException) {
        } finally {
            UnitTemplate::flushEventListeners();
        }
        $this->assertSame([0, 0], [UnitTemplate::query()->count(), UnitTemplateUnit::query()->count()]);
    }

    // ═══════════════════════════════ القوالب القائمة ═══════════════════════════════

    /** @test */
    public function an_existing_template_is_an_error_by_default_and_never_modified(): void
    {
        $existing = UnitTemplate::create(['name' => 'كرتون', 'base_unit' => 'قطعة']);
        UnitTemplateUnit::create(['unit_template_id' => $existing->id, 'name' => 'كرتون', 'factor' => 6]);
        $rows = [$this->row('كرتون', 'قطعة', 'كرتون', '12'), $this->row('جديد', 'قطعة', 'علبة', '3')];

        $preview = $this->service()->preview($this->file($rows), []);
        $this->assertSame(['error', 'create'], $this->actions($preview));
        $this->assertStringContainsString('لا يعدّل قالباً قائماً', $preview['errors'][0]['messages'][0]);

        $this->expectException(ImportUnitFailureException::class);
        try {
            $this->service()->apply($this->file($rows), []);
        } finally {
            $this->assertSame(6, $existing->units()->first()->factor);
            $this->assertSame(1, UnitTemplate::query()->count());
        }
    }

    /** @test */
    public function the_skip_policy_leaves_an_existing_template_untouched_and_creates_the_rest(): void
    {
        $existing = UnitTemplate::create(['name' => 'كرتون', 'base_unit' => 'قطعة']);
        UnitTemplateUnit::create(['unit_template_id' => $existing->id, 'name' => 'كرتون', 'factor' => 6]);
        $rows = [$this->row('كرتون', 'كيلو', 'كرتون', '12'), $this->row('جديد', 'قطعة', 'علبة', '3')];
        $options = ['existing_policy' => 'skip'];

        $preview = $this->service()->preview($this->file($rows), $options);
        $this->assertSame([1, 1, 1], [$preview['create_templates'], $preview['skipped_templates'], $preview['warning_rows']]);

        $result = $this->service()->apply($this->file($rows), $options);

        $this->assertSame([1, 1, 0], [$result['created'], $result['skipped'], $result['updated']]);
        $this->assertSame(['قطعة', 6], [$existing->refresh()->base_unit, $existing->units()->first()->factor]);
    }

    /** @test */
    public function a_template_in_another_isolated_branch_still_blocks_the_name(): void
    {
        \App\Support\BranchSettings::merge(['share_products' => false]);
        $otherId = $this->withToken($this->token)->postJson('/api/branches', ['name' => 'فرع آخر'])->assertCreated()['data']['id'];
        UnitTemplate::withoutGlobalScope(\App\Tenancy\BranchScope::class)->create(['name' => 'مشترك', 'base_unit' => 'قطعة', 'branch_id' => $otherId]);

        $preview = $this->service()->preview($this->file([$this->row('مشترك', 'قطعة')]), []);

        $this->assertSame(['error'], $this->actions($preview));
    }

    // ═══════════════════════════════ لا آثار جانبية ═══════════════════════════════

    /** @test */
    public function importing_templates_touches_no_product(): void
    {
        $product = Product::create(['name' => 'منتج', 'type' => 'good', 'sale_price' => 1000]);
        $before = [Product::query()->count(), $product->updated_at?->toISOString()];

        $this->service()->apply($this->file([$this->row('كرتون', 'قطعة', 'كرتون', '12')]), []);

        $this->assertSame($before, [Product::query()->count(), $product->refresh()->updated_at?->toISOString()]);
        $this->assertNull($product->unit_template_id);
    }

    /** @test */
    public function a_row_wider_than_the_header_is_an_error_not_a_silent_truncation(): void
    {
        $file = UploadedFile::fake()->createWithContent('w.csv', "template_name,base_unit\nأ,قطعة\nب,قطعة, زائد\n");

        $preview = $this->service()->preview($file, []);

        $this->assertSame(['create', 'error'], $this->actions($preview));
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_is_file_atomic_and_canonicalises_options(): void
    {
        $adapter = app(UnitTemplateImportAdapter::class);

        $this->assertSame(['unit_templates', 'file'], [$adapter->domain(), $adapter->unit()]);
        $this->assertSame(UnitTemplateImportService::MAX_ROWS, $adapter->maxRows());
        $this->assertSame(
            ['existing_policy' => 'skip', 'mapping' => ['0' => 'template_name', '1' => 'base_unit']],
            $adapter->canonicalOptions(['existing_policy' => 'skip', 'mapping' => [1 => 'base_unit', 0 => 'template_name'], 'junk' => 1]),
        );
    }

    /** @test */
    public function the_adapter_chunk_creates_the_whole_file_and_reports_the_job_row_count(): void
    {
        $job = new ImportJob;
        $job->row_count = 2;
        $chunk = new ImportChunk($job, $this->file([$this->row('أ', 'قطعة', 'كرتون', '12'), $this->row('ب', 'قطعة')]), null, ['existing_policy' => 'error'], 0, 100, null, true);

        $result = app(UnitTemplateImportAdapter::class)->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertSame(2, UnitTemplate::query()->count());
    }
}

<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Services\PartnerImportAdapter;
use App\Services\PartnerImportService;
use App\Support\ImportChunk;
use App\Support\ImportUnitFailureException;
use App\Support\PartnerImportFields;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * IMP-H3-S1 — استيراد الأطراف: عقد الحقول، المطابقة، الأوضاع، سياسات التكرار، النوافذ، ومحوّل المحرك الدائم (غير مسجَّل بعد: S2).
 *
 * تشغيل: php artisan test --filter=PartnerImportTest
 */
class PartnerImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
    }

    private function service(): PartnerImportService
    {
        return app(PartnerImportService::class);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows, string $name = 'partners.csv'): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($keys, $table));
    }

    private function partner(array $attributes = []): Partner
    {
        return Partner::create($attributes + ['name' => 'قائم', 'type' => 'customer']);
    }

    /** @return list<string> */
    private function actions(array $preview): array
    {
        return array_map(fn (array $row): string => (string) $row['action'], $preview['rows']);
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_field_contract_never_carries_type_or_opening_balance_and_maps_arabic_headers(): void
    {
        foreach (['type', 'opening_balance', 'opening_balance_date', 'tenant_id', 'branch_id'] as $forbidden) {
            $this->assertNotContains($forbidden, PartnerImportFields::keys(), $forbidden);
        }
        $this->assertSame(['nebrax_id'], array_values(array_diff(PartnerImportFields::keys(), PartnerImportFields::writableKeys())));

        $map = PartnerImportFields::autoMap(['الكود', 'الاسم', 'الرقم الضريبي', 'البريد الإلكتروني', 'الجوال', 'مدة الائتمان (أيام)', 'عمود غريب']);
        $this->assertSame(['code', 'name', 'vat_number', 'email', 'mobile', 'credit_period', null], array_values($map));
    }

    /** @test */
    public function the_template_is_importable_as_is(): void
    {
        $csv = $this->service()->template('customer');
        $preview = $this->service()->preview(UploadedFile::fake()->createWithContent('t.csv', $csv), ['type' => 'customer']);

        $this->assertSame(0, $preview['error_rows']);
        $this->assertSame(2, $preview['create_rows']);
    }

    // ═══════════════════════════════ الإنشاء والنوع ═══════════════════════════════

    /** @test */
    public function create_writes_typed_values_and_the_entry_point_fixes_the_type(): void
    {
        $file = $this->file([
            ['code' => 'C-1', 'name' => 'شركة أ', 'vat_number' => '٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣', 'email' => 'A@Example.COM', 'credit_limit' => '1,500.50', 'credit_period' => '30', 'is_active' => 'لا', 'entity_type' => 'فرد', 'type' => 'supplier'],
            ['name' => 'شركة ب'],
        ]);

        $result = $this->service()->apply($file, ['type' => 'supplier']);

        $this->assertSame([2, 0, 0], [$result['created'], $result['updated'], $result['skipped']]);
        $first = Partner::where('code', 'C-1')->firstOrFail();
        $this->assertSame('supplier', $first->type);            // من مدخل الاستيراد، لا من عمود `type` في الملف
        $this->assertSame('300000000000003', $first->vat_number);
        $this->assertSame('a@example.com', $first->email);
        $this->assertSame(150050, $first->credit_limit);          // هللات
        $this->assertSame(30, $first->credit_period);
        $this->assertFalse($first->is_active);
        $this->assertSame('individual', $first->entity_type);
        $second = Partner::where('name', 'شركة ب')->firstOrFail();
        $this->assertSame(['supplier', 'commercial', true], [$second->type, $second->entity_type, $second->is_active]);
    }

    /** @test */
    public function an_opening_balance_column_is_never_imported_and_posts_nothing(): void
    {
        $file = $this->file([['name' => 'رصيد', 'opening_balance' => '5000', 'opening_balance_date' => '2026-01-01']]);

        $preview = $this->service()->preview($file, ['type' => 'customer']);
        $this->assertSame([null, null], array_slice(array_values($preview['mapping']), 1, 2));

        $this->service()->apply($file, ['type' => 'customer']);
        $this->assertSame(0, JournalEntry::count());
    }

    // ═══════════════════════════════ التحقق ═══════════════════════════════

    /** @test */
    public function invalid_cells_are_reported_per_row_in_the_preview_and_block_apply_with_named_units(): void
    {
        $file = $this->file([
            ['name' => 'سليم'],
            ['name' => 'سيئ', 'email' => 'not-an-email', 'vat_number' => '123', 'credit_period' => '99999', 'is_active' => 'ربما', 'entity_type' => 'غريب', 'credit_limit' => '10.123'],
            ['name' => '', 'city' => 'الدمام'],
        ]);

        $preview = $this->service()->preview($file, ['type' => 'customer']);
        $this->assertSame(['create', 'error', 'error'], $this->actions($preview));
        $this->assertSame([3, 4], array_column($preview['errors'], 'row'));
        $this->assertCount(6, $preview['errors'][0]['messages']);

        try {
            $this->service()->apply($file, ['type' => 'customer']);
            $this->fail('apply must refuse a file with invalid rows');
        } catch (ImportUnitFailureException $e) {
            $this->assertSame([1, 2], array_column($e->failures, 'ordinal'));
            $this->assertSame(0, Partner::count());
        }
    }

    // ═══════════════════════════════ المطابقة والأوضاع ═══════════════════════════════

    /** @test */
    public function modes_create_update_and_upsert_match_by_id_then_code_and_never_by_name(): void
    {
        $existing = $this->partner(['code' => 'K-1', 'name' => 'أصل', 'city' => 'جدة']);

        // create over an existing code is an error, not an overwrite
        $this->assertSame(['error'], $this->actions($this->service()->preview($this->file([['code' => 'K-1', 'name' => 'x']]), ['type' => 'customer', 'mode' => 'create'])));

        // update by code
        $this->service()->apply($this->file([['code' => 'K-1', 'name' => 'أصل معدّل', 'city' => 'الدمام']]), ['type' => 'customer', 'mode' => 'update']);
        $existing->refresh();
        $this->assertSame(['أصل معدّل', 'الدمام'], [$existing->name, $existing->city]);

        // the name alone never identifies a row
        $this->expectExceptionMessage('معرّف');
        $this->service()->preview($this->file([['name' => 'أصل معدّل', 'city' => 'x']]), ['type' => 'customer', 'mode' => 'update']);
    }

    /** @test */
    public function upsert_updates_what_exists_creates_the_rest_and_skips_unchanged_rows(): void
    {
        $this->partner(['code' => 'U-1', 'name' => 'ثابت', 'city' => 'الخبر']);
        $this->partner(['code' => 'U-2', 'name' => 'قديم']);

        $file = $this->file([
            ['code' => 'U-1', 'name' => 'ثابت', 'city' => 'الخبر'],
            ['code' => 'U-2', 'name' => 'جديد الاسم'],
            ['code' => 'U-3', 'name' => 'جديد كلياً'],
        ]);

        $this->assertSame(['skip', 'update', 'create'], $this->actions($this->service()->preview($file, ['type' => 'customer', 'mode' => 'upsert'])));
        $result = $this->service()->apply($file, ['type' => 'customer', 'mode' => 'upsert']);
        $this->assertSame([1, 1, 1], [$result['created'], $result['updated'], $result['skipped']]);
    }

    /** @test */
    public function the_code_changes_only_when_matched_by_nebrax_id_and_the_type_never_changes(): void
    {
        $partner = $this->partner(['code' => 'OLD', 'name' => 'ن', 'type' => 'both']);

        $this->service()->apply($this->file([['nebrax_id' => $partner->id, 'code' => 'NEW']]), ['type' => 'customer', 'mode' => 'update']);
        $partner->refresh();
        $this->assertSame(['NEW', 'both'], [$partner->code, $partner->type]);

        // matched by code: the code column is the identifier, so it is not rewritten
        $this->service()->apply($this->file([['code' => 'NEW', 'city' => 'الرياض']]), ['type' => 'customer', 'mode' => 'update']);
        $this->assertSame('الرياض', $partner->refresh()->city);
    }

    /** @test */
    public function a_partner_of_the_other_kind_is_an_error_but_a_both_partner_is_compatible(): void
    {
        $this->partner(['code' => 'S-1', 'name' => 'مورد', 'type' => 'supplier']);
        $this->partner(['code' => 'B-1', 'name' => 'كلاهما', 'type' => 'both']);

        $preview = $this->service()->preview($this->file([['code' => 'S-1', 'city' => 'x'], ['code' => 'B-1', 'city' => 'y']]), ['type' => 'customer', 'mode' => 'update']);

        $this->assertSame(['error', 'update'], $this->actions($preview));
        $this->assertStringContainsString('النوع الآخر', $preview['errors'][0]['messages'][0]);
    }

    /** @test */
    public function an_unknown_id_and_a_conflicting_id_and_code_are_errors(): void
    {
        $a = $this->partner(['code' => 'A', 'name' => 'أ']);
        $b = $this->partner(['code' => 'B', 'name' => 'ب']);

        $preview = $this->service()->preview($this->file([
            ['nebrax_id' => '00000000-0000-4000-8000-000000000000', 'city' => 'x'],
            ['nebrax_id' => $a->id, 'code' => 'B', 'city' => 'y'],
            ['nebrax_id' => 'not-a-uuid', 'city' => 'z'],
        ]), ['type' => 'customer', 'mode' => 'update']);

        $this->assertSame(['error', 'error', 'error'], $this->actions($preview));
        $this->assertSame(3, $preview['error_rows']);
        $this->assertNotNull($b);
    }

    /** @test */
    public function blank_cells_are_ignored_by_default_and_only_clearable_fields_are_cleared_on_request(): void
    {
        $partner = $this->partner(['code' => 'BL', 'name' => 'اسم', 'city' => 'جدة', 'email' => 'x@y.test', 'credit_period' => 45]);
        $file = $this->file([['code' => 'BL', 'name' => '', 'city' => '', 'email' => 'x@y.test', 'credit_period' => '']]);

        $this->service()->apply($file, ['type' => 'customer', 'mode' => 'update']);
        $this->assertSame(['اسم', 'جدة'], [$partner->refresh()->name, $partner->city]);

        $preview = $this->service()->preview($file, ['type' => 'customer', 'mode' => 'update', 'blank_policy' => 'clear']);
        $this->service()->apply($file, ['type' => 'customer', 'mode' => 'update', 'blank_policy' => 'clear']);
        $partner->refresh();
        $this->assertNull($partner->city);                          // قابل للمسح
        $this->assertSame('اسم', $partner->name);                   // الاسم لا يُمسح
        $this->assertSame(45, $partner->credit_period);             // غير قابل للمسح
        $this->assertNotEmpty($preview['rows'][0]['warnings']);
    }

    // ═══════════════════════════════ التكرار ═══════════════════════════════

    /** @test */
    public function duplicates_inside_the_file_fail_the_whole_file_before_any_write(): void
    {
        $file = $this->file([['code' => 'D-1', 'name' => 'أ'], ['code' => 'D-2', 'name' => 'ب'], ['code' => 'd-1', 'name' => 'ج']]);

        try {
            $this->service()->apply($file, ['type' => 'customer']);
            $this->fail('expected a whole-file failure');
        } catch (ImportUnitFailureException $e) {
            $this->assertSame([['ordinal' => 2, 'code' => 'row_duplicate_in_file']], array_map(fn ($f) => ['ordinal' => $f['ordinal'], 'code' => $f['code']], $e->failures));
        }
        $this->assertSame(0, Partner::count());
    }

    /** @test */
    public function the_duplicate_signal_policy_decides_warn_error_or_skip(): void
    {
        $this->partner(['code' => 'V-0', 'name' => 'يحمل الضريبي', 'vat_number' => '300000000000003', 'email' => 'dup@x.test']);
        $rows = [['code' => 'V-1', 'name' => 'مكرر الضريبي', 'vat_number' => '300000000000003'], ['code' => 'V-2', 'name' => 'مكرر البريد', 'email' => 'DUP@x.test'], ['code' => 'V-3', 'name' => 'فريد']];

        $warn = $this->service()->preview($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'warn']);
        $this->assertSame(['create', 'create', 'create'], $this->actions($warn));
        $this->assertSame(2, $warn['warning_rows']);

        $error = $this->service()->preview($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'error']);
        $this->assertSame(['error', 'error', 'create'], $this->actions($error));

        $skip = $this->service()->preview($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'skip']);
        $this->assertSame(['skip', 'skip', 'create'], $this->actions($skip));
        $result = $this->service()->apply($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'skip']);
        $this->assertSame([1, 2], [$result['created'], $result['skipped']]);
        $this->assertNull(Partner::where('code', 'V-1')->first());
    }

    /** @test */
    public function the_same_signal_twice_in_one_file_follows_the_policy_too(): void
    {
        $rows = [['code' => 'F-1', 'name' => 'أ', 'mobile' => '0500000000'], ['code' => 'F-2', 'name' => 'ب', 'mobile' => '٠٥٠٠٠٠٠٠٠٠']];

        $this->assertSame(['create', 'create'], $this->actions($this->service()->preview($this->file($rows), ['type' => 'customer'])));
        $this->assertSame(['create', 'skip'], $this->actions($this->service()->preview($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'skip'])));

        $this->expectException(ImportUnitFailureException::class);
        $this->service()->apply($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'error']);
    }

    /** @test */
    public function a_code_held_by_a_soft_deleted_or_hidden_partner_is_refused_not_a_database_error(): void
    {
        $gone = $this->partner(['code' => 'GONE', 'name' => 'محذوف']);
        $gone->delete();

        $preview = $this->service()->preview($this->file([['code' => 'GONE', 'name' => 'جديد']]), ['type' => 'customer']);

        $this->assertSame(['error'], $this->actions($preview));
        $this->assertStringContainsString('الكود مستخدم', $preview['errors'][0]['messages'][0]);
    }

    /** @test */
    public function the_same_code_in_another_tenant_is_not_a_conflict(): void
    {
        $other = $this->registerTenant('other-co', 'owner@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $this->partner(['code' => 'SAME', 'name' => 'لدى الآخر']);

        app(TenantContext::class)->set($this->tenantId);
        $this->service()->apply($this->file([['code' => 'SAME', 'name' => 'لدينا']]), ['type' => 'customer']);

        $this->assertSame('لدينا', Partner::where('code', 'SAME')->firstOrFail()->name);
        app(TenantContext::class)->set($other['tenant_id']);
        $this->assertSame('لدى الآخر', Partner::where('code', 'SAME')->firstOrFail()->name);
    }

    // ═══════════════════════════════ النوافذ ═══════════════════════════════

    /** @test */
    public function a_window_writes_only_its_rows_while_the_whole_file_is_analysed(): void
    {
        $rows = array_map(fn (int $i): array => ['code' => "W-{$i}", 'name' => "طرف {$i}"], range(1, 5));

        $first = $this->service()->apply($this->file($rows), ['type' => 'customer', 'batch_offset' => 0, 'batch_size' => 2]);
        $this->assertSame([2, 5], [$first['created'], $first['total_rows']]);
        $this->assertSame(['W-1', 'W-2'], Partner::orderBy('code')->pluck('code')->all());

        $this->service()->apply($this->file($rows), ['type' => 'customer', 'batch_offset' => 2, 'batch_size' => 2]);
        $this->service()->apply($this->file($rows), ['type' => 'customer', 'batch_offset' => 4, 'batch_size' => 2]);
        $this->assertSame(5, Partner::count());
    }

    /** @test */
    public function a_changed_plan_between_preview_and_apply_is_refused_as_drift(): void
    {
        $file = $this->file([['code' => 'P-1', 'name' => 'أ']]);
        $planned = $this->service()->previewWithPlan($file, ['type' => 'customer'])['plan'];
        $this->partner(['code' => 'P-1', 'name' => 'ظهر في الأثناء']);   // الصف صار «يطابق قائماً» لا «إنشاء»

        $this->expectException(\App\Support\ImportPlanDriftException::class);
        $this->service()->apply($file, ['type' => 'customer', 'mode' => 'upsert', 'expected_plan' => $planned]);
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_declares_its_domain_and_canonicalises_options(): void
    {
        $adapter = app(PartnerImportAdapter::class);

        $this->assertSame(['partner_master', 'row'], [$adapter->domain(), $adapter->unit()]);
        $this->assertSame(PartnerImportService::DURABLE_MAX_ROWS, $adapter->maxRows());
        $this->assertSame([], $adapter->sensitiveColumnIndexes(['a'], []));
        $this->assertSame(
            ['type' => 'supplier', 'mode' => 'create', 'blank_policy' => 'ignore', 'duplicate_signal_policy' => 'warn', 'mapping' => ['0' => 'code', '1' => null, '2' => 'name']],
            $adapter->canonicalOptions(['type' => 'supplier', 'mapping' => [2 => 'name', 0 => 'code', 1 => null], 'ignored_key' => 'x']),
        );
    }

    /** @test */
    public function the_adapter_chunk_writes_through_the_service_and_reports_processed_units(): void
    {
        $file = $this->file([['code' => 'AD-1', 'name' => 'أ'], ['code' => 'AD-2', 'name' => 'ب'], ['code' => 'AD-3', 'name' => 'ج']]);
        $chunk = new ImportChunk(new ImportJob, $file, null, ['type' => 'customer', 'mode' => 'create'], 0, 2, null, true);

        $result = app(PartnerImportAdapter::class)->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertSame(['AD-1', 'AD-2'], Partner::orderBy('code')->pluck('code')->all());
    }

    // ═══════════════════════════════ مراجعة مستقلة ═══════════════════════════════

    /** @test */
    public function changing_a_code_by_nebrax_id_to_one_held_by_a_hidden_partner_is_refused_before_the_write(): void
    {
        $gone = $this->partner(['code' => 'TAKEN', 'name' => 'محذوف']);
        $gone->delete();
        $target = $this->partner(['code' => 'MINE', 'name' => 'هدف']);

        $preview = $this->service()->preview($this->file([['nebrax_id' => $target->id, 'code' => 'TAKEN']]), ['type' => 'customer', 'mode' => 'update']);

        $this->assertSame(['error'], $this->actions($preview));
        $this->assertStringContainsString('الكود مستخدم', $preview['errors'][0]['messages'][0]);
        $this->assertSame('MINE', $target->refresh()->code);
    }

    /** @test */
    public function stored_values_with_other_formatting_are_still_recognised_as_duplicate_signals(): void
    {
        $this->partner(['code' => 'H-0', 'name' => 'قائم', 'mobile' => '+966 50-000-0000', 'email' => 'Dup@X.test', 'cr_number' => 'ABC-123']);
        $rows = [
            ['code' => 'H-1', 'name' => 'جوال', 'mobile' => '966500000000'],
            ['code' => 'H-2', 'name' => 'بريد', 'email' => 'dup@x.TEST'],
            ['code' => 'H-3', 'name' => 'سجل مختلف', 'cr_number' => 'XYZ123'],
            ['code' => 'H-4', 'name' => 'سجل مكرر', 'cr_number' => 'abc 123'],
        ];

        $this->assertSame(['skip', 'skip', 'create', 'skip'], $this->actions($this->service()->preview($this->file($rows), ['type' => 'customer', 'duplicate_signal_policy' => 'skip'])));
    }

    /** @test */
    public function a_row_wider_than_the_header_is_an_error_not_a_silent_truncation(): void
    {
        $csv = "code,name\nW-1,اسم سليم\nW-2,شارع 1, مبنى 2\n";
        $file = UploadedFile::fake()->createWithContent('wide.csv', $csv);

        $preview = $this->service()->preview($file, ['type' => 'customer']);

        $this->assertSame(['create', 'error'], $this->actions($preview));
        $this->assertStringContainsString('يتجاوز صف العناوين', $preview['errors'][0]['messages'][0]);
    }

    /** @test */
    public function a_legacy_numeric_customer_id_column_is_not_mistaken_for_the_nebrax_uuid(): void
    {
        $this->assertSame([null, 'name'], array_values(PartnerImportFields::autoMap(['customer_id', 'الاسم'])));
    }
}

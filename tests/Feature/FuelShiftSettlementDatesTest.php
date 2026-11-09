<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Services\FuelShiftSettlementDates;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * P1-3b-2a — أعمدة تواريخ التسوية (التوريد والتاريخ المحاسبي) على الرأس + وسم `fuel_sales.source` + قارئ التواريخ الأربعة (SQLite وPostgreSQL).
 *
 * يُدرَج بـSQL خام عمداً (لا كاتب للرأس بعد): الغرض إثبات أن **القاعدة** تفرض الإلزام والاتساق والثبات، وأن القارئ يجمع التواريخ الأربعة من مصادرها
 * الثابتة بلا نسخ. لا أثر محاسبي جديد: البيع النهائي الوحيد هنا بيع ERP عادي من الـfixture.
 */
class FuelShiftSettlementDatesTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_cash_receipts_enabled' => true, 'fuel_stations.shift_collection_declaration_enabled' => true]);
        $this->f = $this->fixture();
    }

    private function rejectsDb(callable $operation): QueryException
    {
        return $this->thrown(fn () => DB::transaction($operation), 'كان يجب أن ترفض القاعدة العملية.', QueryException::class);
    }

    private function header(FuelShift $shift, array $override = []): string
    {
        $id = (string) Str::uuid();
        DB::table('fuel_shift_settlements')->insert($override + [
            'id' => $id, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'fuel_shift_id' => $shift->id, 'status' => 'posted', 'sales_basis' => 'per_invoice', 'preview_hash' => str_repeat('a', 64),
            'policy_snapshot' => json_encode(['mode' => 'post_on_close']), 'metered_milliliters' => 1000, 'erp_milliliters' => 0,
            'residual_milliliters' => 1000, 'settled_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            'supply_started_at' => '2026-10-15 08:00:00', 'supply_ended_at' => '2026-10-15 16:00:00',
            'supply_business_date' => '2026-10-15', 'accounting_date' => '2026-10-15',
        ]);

        return $id;
    }

    // ───────── الإلزام والاتساق عند الإدراج ─────────

    /** @test */
    public function a_header_without_supply_dates_or_with_inconsistent_ones_is_rejected(): void
    {
        $shift = $this->open('d1');
        foreach (['supply_started_at', 'supply_ended_at', 'supply_business_date', 'accounting_date'] as $column) {
            $this->rejectsDb(fn () => $this->header($shift, [$column => null]));
        }
        $this->rejectsDb(fn () => $this->header($shift, ['supply_started_at' => '2026-10-15 17:00:00']));      // البداية بعد النهاية
        $this->rejectsDb(fn () => $this->header($shift, ['accounting_date' => '2026-10-16']));                // تاريخ بديل مرفوض (D-P)
        $this->assertSame(0, DB::table('fuel_shift_settlements')->count());

        $id = $this->header($shift, ['supply_started_at' => '2026-10-15 08:00:00', 'supply_ended_at' => '2026-10-15 08:00:00']); // بداية = نهاية مسموح
        $row = DB::table('fuel_shift_settlements')->where('id', $id)->first();
        $this->assertSame('2026-10-15', substr((string) $row->supply_business_date, 0, 10));
        $this->assertSame('2026-10-15', substr((string) $row->accounting_date, 0, 10));
    }

    /** @test */
    public function the_four_new_columns_are_immutable_after_insert(): void
    {
        $id = $this->header($this->open('d2'));
        foreach ([
            'supply_started_at' => '2026-10-14 08:00:00',
            'supply_ended_at' => '2026-10-15 20:00:00',
            'supply_business_date' => '2026-10-14',
            'accounting_date' => '2026-10-14',
        ] as $column => $value) {
            $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->update([$column => $value]));
            $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->update([$column => null]));
        }
        // وبقية الحقائق ما زالت مجمّدة (مُشغّل SQLite أُعيد بناؤه ولم يُفقد).
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->update(['status' => 'withheld']));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->delete());

        $row = DB::table('fuel_shift_settlements')->where('id', $id)->first();
        $this->assertSame('2026-10-15', substr((string) $row->supply_business_date, 0, 10));
        $this->assertSame('2026-10-15', substr((string) $row->accounting_date, 0, 10));
    }

    // ───────── fuel_sales.source ─────────

    /** @test */
    public function fuel_sales_source_defaults_to_station_is_restricted_and_fixed_at_insert(): void
    {
        $sale = $this->sale('src1', $this->open('d3'));
        $this->assertSame('station', DB::table('fuel_sales')->where('id', $sale->id)->value('source'));

        $this->rejectsDb(fn () => DB::table('fuel_sales')->where('id', $sale->id)->update(['source' => 'settlement']));
        $this->rejectsDb(fn () => DB::table('fuel_sales')->where('id', $sale->id)->update(['source' => 'bogus']));
        $this->assertSame('station', DB::table('fuel_sales')->where('id', $sale->id)->value('source'));

        // الكتابة الأولى بقيمة مسموحة ممكنة عند الإدراج فقط (محرك التسوية)، وغير المسموحة مرفوضة.
        $this->rejectsDb(fn () => $this->insertRawSale('bogus'));
        $this->insertRawSale('settlement');
        $this->assertSame(1, DB::table('fuel_sales')->where('source', 'settlement')->count());
    }

    /** يدرج بيعاً خاماً بنسخة من بيع قائم، بمصدر محدّد، ليختبر قيد القيمة عند الإدراج. */
    private function insertRawSale(string $source): void
    {
        $base = (array) DB::table('fuel_sales')->where('tenant_id', $this->f['tenant_id'])->first();
        if ($base === []) {
            $this->sale('seed-src', $this->open('d3-seed'));
            $base = (array) DB::table('fuel_sales')->where('tenant_id', $this->f['tenant_id'])->first();
        }
        $base['id'] = (string) Str::uuid();
        $base['number'] = 'RAW-'.Str::random(8);
        $base['idempotency_key'] = 'raw-'.Str::random(8);
        $base['source'] = $source;
        DB::table('fuel_sales')->insert($base);
    }

    // ───────── التراجع ─────────

    /** @test */
    public function rolling_back_is_refused_while_any_header_or_settlement_sale_exists(): void
    {
        $migration = require base_path('database/migrations/2027_01_21_010000_add_supply_dates_to_fuel_shift_settlements.php');

        $this->insertRawSale('settlement');
        $e = $this->thrown(fn () => $migration->down(), 'التراجع مرفوض مع وجود بيع تسوية', RuntimeException::class);
        $this->assertStringContainsString('source = settlement', $e->getMessage());
        $this->assertTrue(Schema::hasColumn('fuel_sales', 'source'));

        $this->header(FuelShift::query()->where('tenant_id', $this->f['tenant_id'])->firstOrFail());   // وردية المثبّت نفسها (لا وردية مفتوحة ثانية)
        $e = $this->thrown(fn () => $migration->down(), 'التراجع مرفوض مع وجود رأس', RuntimeException::class);
        $this->assertStringContainsString('رؤوس تسوية', $e->getMessage());
        $this->assertTrue(Schema::hasColumn('fuel_shift_settlements', 'accounting_date'));
    }

    /** @test */
    public function rolling_back_without_rows_removes_the_columns_and_guards_and_up_restores_them(): void
    {
        $migration = require base_path('database/migrations/2027_01_21_010000_add_supply_dates_to_fuel_shift_settlements.php');
        $migration->down();
        foreach (['supply_started_at', 'supply_ended_at', 'supply_business_date', 'accounting_date'] as $column) {
            $this->assertFalse(Schema::hasColumn('fuel_shift_settlements', $column), $column);
        }
        $this->assertFalse(Schema::hasColumn('fuel_sales', 'source'));

        $migration->up();
        foreach (['supply_started_at', 'supply_ended_at', 'supply_business_date', 'accounting_date'] as $column) {
            $this->assertTrue(Schema::hasColumn('fuel_shift_settlements', $column), $column);
        }
        $this->assertTrue(Schema::hasColumn('fuel_sales', 'source'));

        // الحراس عادت كاملة: إدراج بلا تواريخ مرفوض، والثبات قائم.
        $shift = $this->open('d4b');
        $this->rejectsDb(fn () => $this->header($shift, ['supply_business_date' => null]));
        $id = $this->header($shift);
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->update(['accounting_date' => '2026-10-16']));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->update(['status' => 'withheld']));
    }

    /** @test */
    public function collection_dates_migration_rolls_back_cleanly_without_rows_and_up_restores_the_guards(): void
    {
        $migration = require base_path('database/migrations/2027_01_22_010000_add_collection_dates_to_fuel_shift_settlement_collections.php');
        $migration->down();
        $this->assertFalse(Schema::hasColumn('fuel_shift_settlement_collections', 'collected_at'));
        $this->assertFalse(Schema::hasColumn('fuel_shift_settlement_collections', 'collection_date'));

        $migration->up();
        $this->assertTrue(Schema::hasColumn('fuel_shift_settlement_collections', 'collected_at'));
        $this->assertTrue(Schema::hasColumn('fuel_shift_settlement_collections', 'collection_date'));
        // إدراج بلا تاريخ تحصيل مرفوض في القاعدة (الفحص يسبق أي مفتاح أجنبي لأن المُشغّل/القيد على الصف نفسه).
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_collections')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id,
            'fuel_shift_settlement_id' => (string) Str::uuid(), 'payment_method_id' => $this->f['cash']->id, 'invoice_id' => (string) Str::uuid(),
            'payment_id' => (string) Str::uuid(), 'target_kind' => 'settlement', 'amount_minor' => 1, 'created_at' => now(), 'updated_at' => now(),
        ]));
    }

    // ───────── القارئ ─────────

    /** @test */
    public function the_reader_returns_the_four_dates_from_their_immutable_sources_and_is_tenant_scoped(): void
    {
        $shift = $this->open('d5');
        $sale = $this->sale('rd1', $shift);
        $invoice = DB::table('invoices')->where('id', $sale->invoice_id)->first();
        $entry = DB::table('journal_entries')->where('id', $invoice->journal_entry_id)->first();

        $settlementId = $this->header($shift);
        $nozzle = $this->f['nozzle'];
        DB::table('fuel_shift_settlement_lines')->insert([
            'id' => $lineId = (string) Str::uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id,
            'fuel_shift_settlement_id' => $settlementId, 'fuel_nozzle_id' => $nozzle->id, 'fuel_product_id' => $nozzle->fuel_product_id,
            'warehouse_id' => $this->f['station']->warehouse_id, 'metered_milliliters' => 1000, 'erp_milliliters' => 0, 'residual_milliliters' => 1000,
            'state' => 'posted', 'fuel_sale_id' => $sale->id, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $dates = app(FuelShiftSettlementDates::class)->forSettlement($settlementId);
        $this->assertNotNull($dates);
        $this->assertSame(['started_at', 'ended_at', 'business_date'], array_keys($dates['supply']));
        $this->assertSame('2026-10-15', $dates['supply']['business_date']);
        $this->assertSame('2026-10-15', $dates['accounting_date']);

        $this->assertCount(1, $dates['lines']);
        $line = $dates['lines'][0];
        $this->assertSame($lineId, $line['line_id']);
        $this->assertSame($invoice->id, $line['invoice_id']);
        $this->assertSame(substr((string) $invoice->invoice_date, 0, 10), $line['invoice_date']);
        $this->assertSame($invoice->issued_at, $line['issued_at']);
        $this->assertNotNull($line['issued_at'], 'لحظة الإصدار تُقرأ من الفاتورة لا تُنسخ');
        $this->assertSame(substr((string) $entry->entry_date, 0, 10), $line['entry_date']);
        $this->assertSame($entry->created_at, $line['entry_recorded_at']);

        // لا مبالغ ولا تكاليف في الإخراج.
        $flat = json_encode($dates);
        foreach (['amount', 'total', 'cogs', 'cost', 'price'] as $needle) {
            $this->assertStringNotContainsString($needle, $flat);
        }

        // مستأجر آخر لا يرى تسوية غيره.
        app(TenantContext::class)->set($this->f['foreign_tenant_id']);
        $this->assertNull(app(FuelShiftSettlementDates::class)->forSettlement($settlementId));
        app(TenantContext::class)->set($this->f['tenant_id']);
        $this->assertNull(app(FuelShiftSettlementDates::class)->forSettlement((string) Str::uuid()));
    }

    /** @test */
    public function a_line_without_an_invoice_yet_reports_null_invoice_dates(): void
    {
        $shift = $this->open('d6');
        $settlementId = $this->header($shift);
        DB::table('fuel_shift_settlement_lines')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id,
            'fuel_shift_settlement_id' => $settlementId, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_product_id' => $this->f['nozzle']->fuel_product_id,
            'warehouse_id' => $this->f['station']->warehouse_id, 'metered_milliliters' => 1000, 'erp_milliliters' => 0, 'residual_milliliters' => 1000,
            'state' => 'withheld_cost_pool_changed', 'withheld_reason' => 'cost_pool_changed', 'pending_value_minor' => 2300, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $line = app(FuelShiftSettlementDates::class)->forSettlement($settlementId)['lines'][0];
        $this->assertNull($line['invoice_id']);
        $this->assertNull($line['invoice_date']);
        $this->assertNull($line['issued_at']);
        $this->assertNull($line['entry_date']);
        $this->assertNull($line['entry_recorded_at']);
    }

    /** @test */
    public function the_reader_is_read_only(): void
    {
        $code = (string) file_get_contents(app_path('Services/FuelShiftSettlementDates.php'));
        foreach (['->insert(', '->update(', '->delete(', 'lockForUpdate', 'forceFill', '->save(', 'DB::statement', 'DB::unprepared'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $code, "القارئ قراءة فقط: لا {$forbidden}");
        }
    }
}

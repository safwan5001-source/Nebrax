<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\Partner;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * P1-3a — حراس قاعدة البيانات لجداول تسوية ورديات الوقود (SQLite وPostgreSQL بالسلوك نفسه).
 *
 * يُدرَج كل شيء بـSQL خام عمداً: الكاتب `FuelShiftSettlementService` لا يوجد قبل P1-3b، والغرض إثبات أن **القاعدة** تفرض:
 *  ثبات الحقائق · انتقال أحادي لأعمدة الحسم المحدّدة · لا حذف · اتساق المستأجر/الفرع/الوردية/المحطة · القيود الفريدة.
 * بيانات اصطناعية معزولة.
 */
class FuelShiftSettlementSchemaTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        // الـfixture يضبط أساس النقد receiving_shift_receipts فيحتاج البوابة مفتوحة وقت البناء (كاختبارات الأساس المُقَرّ).
        config(['fuel_stations.shift_cash_receipts_enabled' => true, 'fuel_stations.shift_collection_declaration_enabled' => true]);
        $this->f = $this->fixture();
    }

    // ───────── مساعدات ─────────

    private function uuid(): string
    {
        return (string) Str::uuid();
    }

    /** @return array{tenant:string,branch:string,station:string} */
    private function scope(): array
    {
        return ['tenant' => $this->f['tenant_id'], 'branch' => $this->f['branch']->id, 'station' => $this->f['station']->id];
    }

    private function rejectsDb(callable $operation): QueryException
    {
        // نقطة حفظ لكل محاولة: خطأ القاعدة داخل معاملة PostgreSQL يُفسدها (25P02) فلا تصحّ المحاولة التالية دونها.
        return $this->thrown(fn () => DB::transaction($operation), 'كان يجب أن ترفض القاعدة العملية.', QueryException::class);
    }

    private function insertSettlement(FuelShift $shift, array $override = []): string
    {
        $id = $this->uuid();
        DB::table('fuel_shift_settlements')->insert($override + [
            'id' => $id, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'fuel_shift_id' => $shift->id, 'status' => 'posted', 'sales_basis' => 'per_invoice', 'preview_hash' => str_repeat('a', 64),
            'policy_snapshot' => json_encode(['mode' => 'post_on_close']), 'metered_milliliters' => 20000, 'erp_milliliters' => 5000,
            'residual_milliliters' => 15000, 'settled_at' => now(), 'created_at' => now(), 'updated_at' => now(),
            // P1-3b-2a: تواريخ التوريد إلزامية عند الإدراج (مُشغّل).
            'supply_started_at' => '2026-10-15 08:00:00', 'supply_ended_at' => '2026-10-15 16:00:00', 'supply_business_date' => '2026-10-15', 'accounting_date' => '2026-10-15',
        ]);

        return $id;
    }

    private function insertLine(string $settlementId, array $override = []): string
    {
        $id = $this->uuid();
        DB::table('fuel_shift_settlement_lines')->insert($override + [
            'id' => $id, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlementId,
            'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_product_id' => $this->f['fuelProduct']->id, 'warehouse_id' => $this->f['warehouse']->id,
            'metered_milliliters' => 20000, 'erp_milliliters' => 5000, 'residual_milliliters' => 15000, 'price_per_liter_minor' => 230,
            'tax_mode' => 'tax_inclusive', 'expected_gross_minor' => 3450, 'state' => 'posted', 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function insertResolution(string $settlementId, array $override = []): string
    {
        $id = $this->uuid();
        DB::table('fuel_shift_settlement_resolutions')->insert($override + [
            'id' => $id, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlementId,
            'kind' => 'withheld_resolved', 'payload' => json_encode([]), 'resolved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    /** وردية مفتوحة + إغلاقها كي لا يتعارض الفهرس الفريد مع ورديات الاختبار الأخرى. */
    private function shift(string $key): FuelShift
    {
        return $this->open($key);
    }

    // ───────── رأس التسوية ─────────

    /** @test */
    public function a_header_is_unique_per_shift_and_rejects_a_shift_from_another_station_tenant_or_branch(): void
    {
        $shift = $this->shift('hdr');
        $this->insertSettlement($shift);

        $this->rejectsDb(fn () => $this->insertSettlement($shift));
        $this->assertSame(1, DB::table('fuel_shift_settlements')->count());

        // مستأجر آخر لا يستطيع نسب تسوية إلى وردية ليست له ولو بـSQL خام.
        DB::table('fuel_shifts')->where('id', $shift->id)->update(['status' => 'closed']);
        $other = $this->shift('hdr-2');
        $this->rejectsDb(fn () => $this->insertSettlement($other, ['tenant_id' => $this->f['foreign_tenant_id']]));
        $this->rejectsDb(fn () => $this->insertSettlement($other, ['fuel_station_id' => $this->uuid()]));
    }

    /** @test */
    public function header_facts_are_immutable_and_undeletable(): void
    {
        $id = $this->insertSettlement($this->shift('imm'));

        foreach (['status' => 'withheld', 'preview_hash' => str_repeat('b', 64), 'residual_milliliters' => 1, 'pending_value_minor' => 5] as $column => $value) {
            $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->update([$column => $value]));
        }
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlements')->where('id', $id)->delete());

        $row = DB::table('fuel_shift_settlements')->where('id', $id)->first();
        $this->assertSame('posted', $row->status);
        $this->assertSame(15000, (int) $row->residual_milliliters);
    }

    // ───────── السطور والانتقال الأحادي ─────────

    /** @test */
    public function a_line_is_unique_per_nozzle_and_its_facts_are_immutable(): void
    {
        $settlement = $this->insertSettlement($this->shift('ln'));
        $line = $this->insertLine($settlement);

        $this->rejectsDb(fn () => $this->insertLine($settlement));
        foreach (['residual_milliliters' => 1, 'state' => 'withheld_cost_pool_changed', 'expected_gross_minor' => 1, 'price_per_liter_minor' => 1] as $column => $value) {
            $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $line)->update([$column => $value]));
        }
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $line)->delete());
    }

    /** @test */
    public function a_line_resolution_columns_transition_once_from_null_and_never_change_again(): void
    {
        $settlement = $this->insertSettlement($this->shift('trn'));
        $line = $this->insertLine($settlement, ['state' => 'withheld_cost_pool_changed', 'withheld_reason' => 'cost_event', 'pending_value_minor' => 3450]);
        $resolution = $this->insertResolution($settlement);
        $other = $this->insertResolution($settlement);

        // الانتقال المسموح الأول.
        DB::table('fuel_shift_settlement_lines')->where('id', $line)->update(['resolution_id' => $resolution, 'updated_at' => now()]);
        $this->assertSame($resolution, DB::table('fuel_shift_settlement_lines')->where('id', $line)->value('resolution_id'));

        // لا تغيير ثانٍ ولا مسح، حتى لقيمة مختلفة صالحة.
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $line)->update(['resolution_id' => $other]));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $line)->update(['resolution_id' => null]));
        // ولا يتزامن الانتقال مع تعديل عمود ثابت.
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $line)->update(['fuel_sale_id' => null, 'pending_value_minor' => 0]));
        $this->assertSame(3450, (int) DB::table('fuel_shift_settlement_lines')->where('id', $line)->value('pending_value_minor'));
    }

    /** @test */
    public function a_line_sale_link_is_single_use_and_unique_across_lines(): void
    {
        $shift = $this->shift('sale-link');
        $sale = $this->sale('sl-1', $shift);
        $settlement = $this->insertSettlement($shift);
        $line = $this->insertLine($settlement);

        DB::table('fuel_shift_settlement_lines')->where('id', $line)->update(['fuel_sale_id' => $sale->id]);
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $line)->update(['fuel_sale_id' => null]));

        // البيع نفسه لا يُربط بسطر ثانٍ: وردية ثانية بعد إغلاق الأولى (تحديث خام يتجاوز الخدمة لغرض الاختبار).
        DB::table('fuel_shifts')->where('id', $shift->id)->update(['status' => 'closed']);
        $second = $this->insertSettlement($this->shift('sale-link-2'));
        $secondLine = $this->insertLine($second);
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_lines')->where('id', $secondLine)->update(['fuel_sale_id' => $sale->id]));
        $this->assertSame(1, DB::table('fuel_shift_settlement_lines')->whereNotNull('fuel_sale_id')->count());
    }

    /** @test */
    public function a_line_of_another_tenant_is_rejected_even_with_raw_sql(): void
    {
        $settlement = $this->insertSettlement($this->shift('x-tenant'));
        $this->rejectsDb(fn () => $this->insertLine($settlement, ['tenant_id' => $this->f['foreign_tenant_id']]));
        $this->rejectsDb(fn () => $this->insertLine($settlement, ['branch_id' => $this->uuid()]));
    }

    // ───────── التخصيصات ─────────

    /** @test */
    public function collections_are_immutable_unique_per_target_and_payment_and_reject_foreign_parents(): void
    {
        $shift = $this->shift('col');
        $sale = $this->sale('col-1', $shift);
        $payment = $this->collect($sale, 'cash', null, 'col-p1');
        $settlement = $this->insertSettlement($shift);

        $insert = fn (array $o = []) => DB::table('fuel_shift_settlement_collections')->insert($o + [
            'id' => $this->uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlement,
            'payment_method_id' => $this->f['cash']->id, 'invoice_id' => $sale->invoice_id, 'payment_id' => $payment->id,
            'target_kind' => 'erp_walk_in', 'amount_minor' => 230, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $insert();

        $this->rejectsDb(fn () => $insert());                                   // تكرار (طريقة، فاتورة) وسند
        $this->rejectsDb(fn () => $insert(['amount_minor' => 0, 'payment_id' => $this->uuid()]));
        $this->rejectsDb(fn () => $insert(['tenant_id' => $this->f['foreign_tenant_id'], 'payment_id' => $this->uuid()]));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_collections')->update(['amount_minor' => 5]));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_collections')->delete());
        $this->assertSame(230, (int) DB::table('fuel_shift_settlement_collections')->value('amount_minor'));
    }

    // ───────── سجل الفروق ─────────

    /** @test */
    public function a_held_variance_is_allocated_once_and_other_kinds_never_transition(): void
    {
        $shift = $this->shift('var');
        $sale = $this->sale('var-1', $shift);
        $payment = $this->collect($sale, 'cash', null, 'var-p1');
        $settlement = $this->insertSettlement($shift);
        $collection = $this->uuid();
        DB::table('fuel_shift_settlement_collections')->insert([
            'id' => $collection, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlement,
            'payment_method_id' => $this->f['cash']->id, 'invoice_id' => $sale->invoice_id, 'payment_id' => $payment->id,
            'target_kind' => 'resolved_withheld', 'amount_minor' => 230, 'created_at' => now(), 'updated_at' => now(),
        ]);

        // العجز إجماليّ بلا طريقة؛ الزيادة والمحجوز لكل طريقة.
        $variance = fn (string $kind, array $o = []) => DB::table('fuel_shift_settlement_variances')->insert($o + [
            'id' => $this->uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlement,
            'payment_method_id' => $kind === 'shortage' ? null : $this->f['cash']->id, 'settlement_type' => $kind === 'shortage' ? null : 'cash',
            'kind' => $kind, 'amount_minor' => 600, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $variance('held_for_withheld');
        $variance('shortage');

        $this->rejectsDb(fn () => $variance('shortage'));                       // عجز واحد إجماليّ لكل تسوية (فهرس جزئي)
        if (DB::getDriverName() === 'pgsql') { // قيود CHECK (ومنها: الزيادة تتطلب طريقة)
            $this->rejectsDb(fn () => $variance('surplus', ['payment_method_id' => null, 'settlement_type' => null, 'id' => $this->uuid()])); // قيود CHECK للقيم المعدودة PostgreSQL فقط (SQLite بلا ALTER ... ADD CONSTRAINT)؛ الخدمة تفرضها هناك.
            $this->rejectsDb(fn () => $variance('bogus_kind'));
        }
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_variances')->where('kind', 'held_for_withheld')->update(['amount_minor' => 1]));

        DB::table('fuel_shift_settlement_variances')->where('kind', 'held_for_withheld')->update(['allocated_collection_id' => $collection]);
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_variances')->where('kind', 'held_for_withheld')->update(['allocated_collection_id' => null]));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_variances')->delete());
    }

    // ───────── سجل الحسم الإلحاقي ─────────

    /** @test */
    public function resolutions_are_append_only(): void
    {
        $settlement = $this->insertSettlement($this->shift('res'));
        $resolution = $this->insertResolution($settlement);

        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_resolutions')->where('id', $resolution)->update(['note' => 'تعديل']));
        $this->rejectsDb(fn () => DB::table('fuel_shift_settlement_resolutions')->where('id', $resolution)->delete());
        $this->rejectsDb(fn () => $this->insertResolution($settlement, ['tenant_id' => $this->f['foreign_tenant_id']]));
        $this->insertResolution($settlement); // إلحاق جديد مسموح
        $this->assertSame(2, DB::table('fuel_shift_settlement_resolutions')->count());
    }

    // ───────── التاريخ المفتوح للمجمّع ─────────

    /** @test */
    public function an_open_pool_history_closes_once_and_resolution_and_time_move_together(): void
    {
        $settlement = $this->insertSettlement($this->shift('hist'));
        $line = $this->insertLine($settlement, ['state' => 'withheld_cost_pool_changed', 'withheld_reason' => 'cost_event']);
        $resolution = $this->insertResolution($settlement);
        $history = $this->uuid();
        $row = fn (array $o = []) => DB::table('fuel_cost_pool_open_histories')->insert($o + [
            'id' => $history, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'warehouse_id' => $this->f['warehouse']->id, 'fuel_product_id' => $this->f['fuelProduct']->id, 'fuel_shift_settlement_line_id' => $line,
            'reason' => 'withheld_cost_pool_changed', 'opened_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $row();

        $this->rejectsDb(fn () => $row(['id' => $this->uuid()]));                // سطر واحد ⇒ تاريخ واحد
        $this->rejectsDb(fn () => DB::table('fuel_cost_pool_open_histories')->where('id', $history)->update(['reason' => 'withheld_period_boundary']));
        $this->rejectsDb(fn () => DB::table('fuel_cost_pool_open_histories')->where('id', $history)->delete());

        DB::table('fuel_cost_pool_open_histories')->where('id', $history)->update(['resolution_id' => $resolution, 'resolved_at' => now()]);
        $this->assertNotNull(DB::table('fuel_cost_pool_open_histories')->where('id', $history)->value('resolved_at'));
        $this->rejectsDb(fn () => DB::table('fuel_cost_pool_open_histories')->where('id', $history)->update(['resolved_at' => null, 'resolution_id' => null]));
    }

    // ───────── العميل النقدي لكل محطة ─────────

    /** @test */
    public function the_walk_in_link_requires_a_flagged_same_tenant_partner_and_is_unique_per_station_and_per_partner(): void
    {
        $flagged = Partner::create(['tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'name' => 'نقدي', 'type' => 'customer', 'code' => 'FWI-T1']);
        DB::table('partners')->where('id', $flagged->id)->update(['system_kind' => 'fuel_walk_in']);

        $link = fn (string $partnerId, array $o = []) => DB::table('fuel_station_walk_in_partners')->insert($o + [
            'id' => $this->uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'partner_id' => $partnerId, 'created_at' => now(), 'updated_at' => now(),
        ]);

        // طرف عادي غير موسوم مرفوض.
        $this->rejectsDb(fn () => $link($this->f['customer']->id));
        $link($flagged->id);

        $this->rejectsDb(fn () => $link($flagged->id));                          // المحطة والطرف فريدان
        $this->rejectsDb(fn () => DB::table('fuel_station_walk_in_partners')->update(['partner_id' => $this->f['customer']->id]));
        $this->rejectsDb(fn () => DB::table('fuel_station_walk_in_partners')->delete());

        // مستأجر آخر لا يربط طرفنا ولا محطتنا.
        $this->rejectsDb(fn () => $link($flagged->id, ['id' => $this->uuid(), 'tenant_id' => $this->f['foreign_tenant_id']]));
        $this->assertSame(1, DB::table('fuel_station_walk_in_partners')->count());
    }

    // ───────── الهجرة ─────────

    /** @test */
    public function the_migration_refuses_to_roll_back_while_any_settlement_row_exists(): void
    {
        $migration = require base_path('database/migrations/2027_01_18_020000_create_fuel_shift_settlement_tables.php');
        $this->insertSettlement($this->shift('mig'));

        $this->thrown(fn () => $migration->down(), 'التراجع يجب أن يُرفض عند وجود صفوف.');
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasTable('fuel_shift_settlements'));
        $this->assertSame(1, DB::table('fuel_shift_settlements')->count());
    }

    /** @test */
    public function the_system_kind_migration_refuses_to_roll_back_while_flagged_partners_exist(): void
    {
        $migration = require base_path('database/migrations/2027_01_18_010000_add_system_kind_to_partners.php');
        $partner = Partner::create(['tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'name' => 'نقدي', 'type' => 'customer', 'code' => 'FWI-T2']);
        DB::table('partners')->where('id', $partner->id)->update(['system_kind' => 'fuel_walk_in']);

        $this->thrown(fn () => $migration->down(), 'التراجع يجب أن يُرفض عند وجود أطراف موسومة.');
        $this->assertSame('fuel_walk_in', DB::table('partners')->where('id', $partner->id)->value('system_kind'));
    }

    /** @test */
    public function the_open_shift_unique_index_that_settlement_relies_on_already_exists(): void
    {
        // F-3 في وثيقة التصميم كان ناقصاً: الفهرس الجزئي موجود من FS-33 (2026_12_27). هذا الاختبار يثبّت الاعتماد عليه.
        $shift = $this->shift('uniq');
        $this->assertSame(FuelShift::STATUS_OPEN, $shift->status);
        $this->rejectsDb(fn () => DB::table('fuel_shifts')->insert([
            'id' => $this->uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'number' => 'FSH-RAW-DUP', 'status' => 'open', 'opening_float_minor' => 0, 'operational_meter_milliliters' => 0,
            'operational_delivery_milliliters' => 0, 'opened_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]));
    }
}

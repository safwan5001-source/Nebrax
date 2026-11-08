<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\Partner;
use App\Models\User;
use App\Services\Accounting\InventoryService;
use App\Services\FuelCostBasisService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementPreviewService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P1-3a — معاينة تسوية الوردية (قراءة فقط) وشروط تفعيلها وتعيين العميل النقدي للمحطة.
 *
 * الأرقام: السعر 230 هللة/لتر شامل ضريبة، فـ20 لتراً (عدّاد 1,000,000 → 1,020,000 مل) = 4600 هللة.
 * الحاكم: **لا فاتورة ولا سند ولا قيد ولا حركة مخزون ولا حالة تكلفة ولا صف تسوية** ينتج عن أي معاينة (يعدّ الاختبار صفوف الجداول قبل وبعد).
 * بيانات اصطناعية معزولة.
 */
class FuelShiftSettlementPreviewTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/shifts';

    private ?Partner $walkIn = null;

    protected function setUp(): void
    {
        parent::setUp();
        $this->openGates();
        $this->f = $this->fixture();
        $this->setBasis('declared_collection');
        $this->walkIn = app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor'])['partner'];
        // السياسة مفعَّلة للمحطة افتراضياً في هذا الاختبار (تثبت أيضاً أن شروط الجاهزية تُستوفى بالتهيئة العادية)؛ الاختبارات المعنية تُعيدها none.
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        // أحداث التكلفة تُقارن بفتح الوردية بدقة الثانية والحكم محافظ (>=): نُبعد فتح الورديات عن بناء الـfixture.
        $this->travel(3)->seconds();
    }

    private function policyNone(): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => null], $this->f['actor'], 'إعادة none');
    }

    /** رمز مستأجر آخر **مؤهَّل** (قدرة المحطات ممنوحة) كي يُختبر العزل لا غياب الاستحقاق. */
    private function foreignToken(string $email): string
    {
        $token = $this->tokenForRole($this->f['foreign_tenant_id'], 'owner', $email);
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($this->f['foreign_tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_foreign_isolation', reason: 'اختبار عزل المستأجر.',
        );
        app(\App\Tenancy\TenantContext::class)->set($this->f['tenant_id']);

        return $token;
    }

    private function openGates(): void
    {
        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-1',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
    }

    // ───────── مساعدات ─────────

    private function meters(FuelShift $shift, int $opening = 1_000_000, int $closing = 1_020_000): void
    {
        foreach (['opening' => $opening, 'closing' => $closing] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "pm-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
    }

    private function declare(FuelShift $shift, int $cash, int $bank = 0, string $key = 'decl', int $base = 0): void
    {
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.$key, 'base_revision' => $base,
            'lines' => [
                ['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cash],
                ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => $bank],
            ],
        ], $this->f['actor']);
    }

    /** وردية جاهزة: عدّاد 20 لتراً + إقرار. */
    private function readyShift(string $key, int $cash, int $bank = 0): FuelShift
    {
        $shift = $this->open($key);
        $this->meters($shift);
        $this->declare($shift, $cash, $bank);

        return $shift;
    }

    private function walkInSale(string $key, FuelShift $shift, int $ml = 10_000): FuelSale
    {
        $service = app(\App\Services\FuelSaleService::class);

        return $service->finalize($service->createDraft([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $this->walkIn->id, 'quantity_milliliters' => $ml, 'idempotency_key' => $key,
        ], $this->f['actor']), $this->f['actor']);
    }

    private function preview(FuelShift $shift, ?User $viewer = null): array
    {
        return app(FuelShiftSettlementPreviewService::class)->preview($shift->fresh(), $viewer ?? $this->f['actor']);
    }

    private function finance(string $key = 'fin', bool $cost = false): User
    {
        $permissions = ['fuel.shift.view', 'fuel.shift.close', 'fuel.sale.view'] + ($cost ? [3 => 'products.view_cost'] : []);

        return $this->roleUser($this->f['tenant_id'], "preview-{$key}", "preview-{$key}@settlement.test", array_values($permissions));
    }

    /** @return array<string,int> صفوف كل ما يجب ألا تكتبه المعاينة. */
    private function writeCounts(): array
    {
        $tables = ['invoices', 'invoice_lines', 'journal_entries', 'journal_lines', 'payments', 'payment_allocations', 'stock_movements', 'fuel_sales',
            'fuel_sale_payment_receipts', 'fuel_inventory_cost_states', 'fuel_inventory_cost_movements', 'fuel_operational_ledgers', 'partners',
            'fuel_shift_settlements', 'fuel_shift_settlement_lines', 'fuel_shift_settlement_collections', 'fuel_shift_settlement_variances',
            'fuel_shift_settlement_resolutions', 'fuel_cost_pool_open_histories', 'fuel_station_walk_in_partners', 'fuel_shifts', 'fuel_shift_events',
            'fuel_shift_collection_declarations', 'fuel_shift_collection_revisions', 'zatca_chain_entries'];

        return collect($tables)->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all();
    }

    private function row(array $preview, string $kind, ?string $type = null): ?array
    {
        return collect($preview['allocation']['rows'])->first(fn ($r) => $r['target_kind'] === $kind && ($type === null || $r['settlement_type'] === $type));
    }

    // ───────── البوابة ─────────

    /** @test */
    public function the_gate_closed_hides_every_settlement_route_and_changes_nothing_else(): void
    {
        $shift = $this->readyShift('g1', 4600);
        $token = $this->f['actor']->createToken('t')->plainTextToken;

        foreach ([['flag' => false, 'ref' => 'TAX-OPINION'], ['flag' => true, 'ref' => ''], ['flag' => true, 'ref' => '   ']] as $case) {
            config(['fuel_stations.shift_settlement_enabled' => $case['flag'], 'fuel_stations.shift_settlement_tax_opinion_ref' => $case['ref']]);
            $this->withToken($token)->getJson(self::BASE."/{$shift->id}/settlement-preview")->assertNotFound();
            $this->withToken($token)->getJson("/api/fuel-stations/stations/{$this->f['station']->id}/walk-in-partner")->assertNotFound();
            $this->withToken($token)->putJson("/api/fuel-stations/stations/{$this->f['station']->id}/walk-in-partner")->assertNotFound();
        }
    }

    /** @test */
    public function the_open_gate_serves_the_preview_with_no_store_and_never_mutates(): void
    {
        $shift = $this->readyShift('g2', 4600);
        $before = $this->writeCounts();
        $token = $this->f['actor']->createToken('t')->plainTextToken;

        $response = $this->withToken($token)->getJson(self::BASE."/{$shift->id}/settlement-preview")->assertOk();
        $response->assertHeader('Cache-Control', 'no-store, private');
        $this->assertTrue($response->json('data.writes_nothing'));
        $this->assertSame($before, $this->writeCounts());
    }

    // ───────── السياسة والجاهزية ─────────

    /** @test */
    public function the_policy_defaults_to_none_and_cannot_be_turned_on_while_the_deployment_gate_is_closed(): void
    {
        $settings = app(FuelStationSettingsService::class);
        $this->policyNone();
        $this->assertSame('none', $settings->get($this->f['station'], 'shift_settlement_mode'));

        config(['fuel_stations.shift_settlement_enabled' => false]);
        $this->rejects(fn () => $settings->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل'));
        config(['fuel_stations.shift_settlement_enabled' => true, 'fuel_stations.shift_settlement_tax_opinion_ref' => '']);
        $this->rejects(fn () => $settings->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل'));
        $this->assertSame('none', $settings->get($this->f['station'], 'shift_settlement_mode'));
    }

    /** @test */
    public function the_policy_requires_every_readiness_condition_and_rolls_back_the_whole_request_otherwise(): void
    {
        $settings = app(FuelStationSettingsService::class);
        $this->policyNone();
        // نعطّل شرطاً واحداً: الأساس غير مُقَرّ.
        $this->setBasis('movements_only');
        $error = $this->rejects(fn () => $settings->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل'));
        $this->assertStringContainsString('CASH_BASIS_NOT_DECLARED', $error->getMessage());
        $this->assertSame('none', $settings->get($this->f['station'], 'shift_settlement_mode'));

        // الأساس والسياسة في الطلب نفسه: يصح لأن الفحص بعد حفظ كل المفاتيح.
        $settings->putStationValues($this->f['station'], ['shift_expected_cash_basis' => 'declared_collection', 'shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل');
        $this->assertSame('post_on_close', $settings->get($this->f['station'], 'shift_settlement_mode'));
    }

    /** @test */
    public function the_policy_is_a_governance_key_and_an_ordinary_admin_cannot_set_it(): void
    {
        $this->policyNone();
        $manager = $this->roleUser($this->f['tenant_id'], 'plain-manager', 'plain-manager@settlement.test', ['fuel_stations.manage']);
        $this->thrown(
            fn () => app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $manager, 'x'),
            'مفتاح حوكمة يرفض غير المخوَّل.',
            \Illuminate\Auth\Access\AuthorizationException::class,
        );
        $this->assertSame('none', app(FuelStationSettingsService::class)->get($this->f['station'], 'shift_settlement_mode'));
    }

    /** @test */
    public function the_policy_is_not_accepted_as_a_device_override(): void
    {
        $this->rejects(fn () => app(FuelStationSettingsService::class)->putDevice($this->f['station'], 'dev-1', 'shift_settlement_mode', 'post_on_close', $this->f['actor'], 'x'));
    }

    // ───────── العميل النقدي للمحطة ─────────

    /** @test */
    public function the_walk_in_partner_is_deterministic_untaxed_flagged_idempotent_and_hidden_from_the_customer_list(): void
    {
        $partner = $this->walkIn->fresh();
        $this->assertSame(FuelStationWalkInPartnerService::codeFor($this->f['tenant_id'], $this->f['station']->id), $partner->code);
        $this->assertSame('fuel_walk_in', DB::table('partners')->where('id', $partner->id)->value('system_kind'));
        $this->assertNull($partner->vat_number, 'بلا رقم ضريبي فتُصنَّف فاتورته مبسّطة');
        $this->assertSame('customer', $partner->type);

        $before = $this->writeCounts();
        $again = app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        $this->assertFalse($again['created']);
        $this->assertSame($partner->id, $again['partner']->id);
        $this->assertSame($before, $this->writeCounts());

        $token = $this->f['actor']->createToken('t')->plainTextToken;
        $names = collect($this->withToken($token)->getJson('/api/partners')->assertOk()->json('data'))->pluck('id');
        $this->assertFalse($names->contains($partner->id), 'العميل النقدي لا يظهر في قائمة العملاء');
        $this->assertTrue($names->contains($this->f['customer']->id));
    }

    /** @test */
    public function the_public_partner_search_does_not_list_the_walk_in_partner(): void
    {
        $service = app(\App\Services\ApiClientKeyService::class);
        $client = $service->createClient(\App\Models\Tenant::findOrFail($this->f['tenant_id']), 'integration');
        $key = $service->issueKey($client, 'k', ['partners:read'])->plainTextToken;
        \Illuminate\Support\Facades\Auth::shouldUse('web'); // مسارات الـInternal تترك حارس sanctum في عملية الاختبار

        $ids = collect($this->withToken($key)->getJson('/api/v1/partners?per_page=100')->assertOk()->json('data'))->pluck('id');
        $this->assertFalse($ids->contains($this->walkIn->id));
        $this->assertTrue($ids->contains($this->f['customer']->id));
    }

    /** @test */
    public function assigning_the_walk_in_partner_posts_no_accounting_entries(): void
    {
        $other = \App\Models\FuelStation::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id,
            'code' => 'FCS-2', 'name' => 'محطة ثانية',
        ]);
        $before = $this->writeCounts();
        $second = app(FuelStationWalkInPartnerService::class)->assign($other, $this->f['actor']);

        $this->assertTrue($second['created']);
        $this->assertNotSame($this->walkIn->id, $second['partner']->id, 'لكل محطة عميلها');
        $after = $this->writeCounts();
        $this->assertSame($before['partners'] + 1, $after['partners']);
        $this->assertSame($before['fuel_station_walk_in_partners'] + 1, $after['fuel_station_walk_in_partners']);
        foreach (['journal_entries', 'journal_lines', 'invoices', 'payments', 'stock_movements'] as $table) {
            $this->assertSame($before[$table], $after[$table], $table);
        }
    }

    /** @test */
    public function assigning_the_walk_in_partner_needs_governance_permission_and_a_station_in_scope(): void
    {
        $manager = $this->roleUser($this->f['tenant_id'], 'wi-manager', 'wi-manager@settlement.test', ['fuel_stations.manage', 'fuel_stations.view']);
        $this->thrown(
            fn () => app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $manager),
            'بلا حوكمة الوقود يُرفض التعيين.',
            \Illuminate\Auth\Access\AuthorizationException::class,
        );

        // مستأجر آخر لا يرى محطتنا (404 موحَّد).
        $foreign = $this->foreignToken('foreign-owner@settlement.test');
        $this->withToken($foreign)->putJson("/api/fuel-stations/stations/{$this->f['station']->id}/walk-in-partner")->assertNotFound();
        $this->withToken($foreign)->getJson("/api/fuel-stations/stations/{$this->f['station']->id}/walk-in-partner")->assertNotFound();
    }

    // ───────── حساب المعاينة (سيناريوهات §10) ─────────

    /** @test */
    public function s1_a_clean_cash_shift_settles_one_invoice_and_one_voucher_with_no_variance(): void
    {
        $shift = $this->readyShift('s1', 4600);
        $before = $this->writeCounts();
        $p = $this->preview($shift);

        $this->assertSame([], $p['blockers'], json_encode($p['blockers']));
        $this->assertTrue($p['ready']);
        $line = $p['lines'][0];
        $this->assertSame(20000, $line['metered_milliliters']);
        $this->assertSame(0, $line['erp_milliliters']);
        $this->assertSame(20000, $line['residual_milliliters']);
        $this->assertSame(4600, $line['expected_gross_minor']);
        $this->assertSame('posted', $line['state']);
        $this->assertSame(4600, $p['reference']['total_minor']);
        $this->assertSame(0, $p['declaration']['difference_vs_reference_minor']);
        $this->assertSame(4600, $this->row($p, 'settlement', 'cash')['amount_minor']);
        $this->assertSame(0, $p['variances']['shortage_minor']);
        $this->assertSame([], $p['variances']['surplus']);
        $this->assertSame($before, $this->writeCounts(), 'المعاينة لا تكتب أي صف');
    }

    /** @test */
    public function s2_mixed_collection_allocates_the_network_first_then_cash(): void
    {
        $p = $this->preview($this->readyShift('s2', 2000, 2600));

        $this->assertSame('bank', $p['allocation']['rows'][0]['settlement_type'], 'الشبكة أولاً');
        $this->assertSame(2600, $p['allocation']['rows'][0]['amount_minor']);
        $this->assertSame(2000, $this->row($p, 'settlement', 'cash')['amount_minor']);
        $this->assertSame(4600, $p['allocation']['allocated_total_minor']);
        $this->assertSame(0, $p['variances']['shortage_minor']);
    }

    /** @test */
    public function s3_shortage_is_a_total_not_attributed_to_a_method_and_leaves_the_balance_open(): void
    {
        $p = $this->preview($this->readyShift('s3', 4000));

        $this->assertSame(4000, $p['allocation']['allocated_total_minor']);
        $this->assertSame(600, $p['variances']['shortage_minor']);
        $this->assertSame(-600, $p['declaration']['difference_vs_reference_minor']);
    }

    /** @test */
    public function s4_surplus_is_recorded_per_method_and_never_over_pays_an_invoice(): void
    {
        $p = $this->preview($this->readyShift('s4', 5000));

        $this->assertSame(4600, $p['allocation']['allocated_total_minor'], 'لا يُدفع للفاتورة أكثر من متبقيها');
        $this->assertSame(0, $p['variances']['shortage_minor']);
        $this->assertCount(1, $p['variances']['surplus']);
        $this->assertSame(400, $p['variances']['surplus'][0]['amount_minor']);
        $this->assertSame($this->f['cash']->id, $p['variances']['surplus'][0]['payment_method_id']);
    }

    /** @test */
    public function s5_an_unpaid_walk_in_erp_invoice_is_settled_once_and_only_the_remaining_liters_are_valued(): void
    {
        $shift = $this->open('s5');
        $this->meters($shift);
        $sale = $this->walkInSale('s5-sale', $shift, 10_000);     // 10 لتر = 2300
        $this->declare($shift, 4600);
        $p = $this->preview($shift);

        $this->assertSame(10000, $p['lines'][0]['erp_milliliters']);
        $this->assertSame(10000, $p['lines'][0]['residual_milliliters']);
        $this->assertSame(2300, $p['lines'][0]['expected_gross_minor']);
        $this->assertSame(2300, $this->row($p, 'erp_walk_in')['amount_minor']);
        $this->assertSame($sale->invoice_id, $this->row($p, 'erp_walk_in')['invoice_id']);
        $this->assertSame(2300, $this->row($p, 'settlement')['amount_minor']);
        $this->assertSame(4600, $p['reference']['total_minor'], 'فاتورة ERP (2300) + فاتورة التسوية (2300)');
        $this->assertSame(0, $p['declaration']['difference_vs_reference_minor']);
    }

    /** @test */
    public function s6_a_fully_paid_erp_sale_creates_no_second_invoice_and_no_double_collection(): void
    {
        $shift = $this->open('s6');
        $this->meters($shift);
        $sale = $this->walkInSale('s6-sale', $shift, 20_000);     // كل اللترات عبر ERP = 4600
        $this->collect($sale, 'cash', null, 's6-pay');             // مدفوعة بإيصال مختوم
        $this->declare($shift, 4600);
        $p = $this->preview($shift);

        $this->assertSame(0, $p['lines'][0]['residual_milliliters']);
        $this->assertSame('no_residual', $p['lines'][0]['state']);
        $this->assertSame([], $p['allocation']['rows'], 'U = D − R = 0 ⇒ لا سند ثانٍ');
        $this->assertSame(4600, $p['reference']['total_minor']);
        $this->assertSame(0, $p['declaration']['difference_vs_reference_minor']);
        $this->assertSame(0, $p['variances']['shortage_minor']);
        $this->assertSame([], $p['variances']['surplus']);
        $this->assertSame([], $p['journal'], 'لا فاتورة ولا سند متوقعان');
    }

    /** @test */
    public function s10_when_all_liters_are_erp_invoiced_and_unpaid_the_declared_cash_settles_the_existing_invoice(): void
    {
        $shift = $this->open('s10');
        $this->meters($shift);
        $sale = $this->walkInSale('s10-sale', $shift, 20_000);
        $this->declare($shift, 4600);
        $p = $this->preview($shift);

        $this->assertSame(0, $p['lines'][0]['residual_milliliters']);
        $this->assertSame(4600, $this->row($p, 'erp_walk_in')['amount_minor']);
        $this->assertSame($sale->invoice_id, $this->row($p, 'erp_walk_in')['invoice_id']);
        $this->assertNull($this->row($p, 'settlement'));
        $this->assertSame(0, $p['variances']['shortage_minor']);
    }

    /** @test */
    public function s7_a_corporate_contract_invoice_is_never_touched_by_the_allocation(): void
    {
        $shift = $this->open('s7');
        $this->meters($shift);
        $this->corporateSale('s7-corp', $shift);                   // 1 لتر عقد شركة، آجل
        $this->declare($shift, 4370);                              // 19 لتراً = 4370
        $p = $this->preview($shift);

        $this->assertSame(1000, $p['lines'][0]['erp_milliliters']);
        $this->assertSame(19000, $p['lines'][0]['residual_milliliters']);
        $this->assertSame(4370, $p['lines'][0]['expected_gross_minor']);
        $this->assertNull($this->row($p, 'erp_walk_in'), 'فاتورة العقد ليست هدف تخصيص');
        $this->assertSame(4370, $this->row($p, 'settlement')['amount_minor']);
        $this->assertSame(4370, $p['reference']['total_minor'], 'الآجل غير المحصَّل خارج المرجع');
    }

    /** @test */
    public function collecting_yesterdays_walk_in_invoice_today_is_a_reference_component_not_a_false_surplus(): void
    {
        // وردية الأمس: بيع نقدي لعميل المحطة 1 لتر = 230 غير مسدَّد، ثم تُغلق.
        $yesterday = $this->open('y1');
        $sale = $this->walkInSale('y1-sale', $yesterday, 1000);
        $this->meters($yesterday, 1_000_000, 1_001_000);
        $this->declare($yesterday, 0, 0);
        app(FuelShiftService::class)->close($yesterday->fresh(), 20000, 'إغلاق الأمس', $this->f['actor']);

        // وردية اليوم: بلا مبيعات عدّاد، تحصّل 230 على فاتورة الأمس (إيصال مختوم بوردية اليوم).
        $today = $this->open('y2');
        $this->meters($today, 1_001_000, 1_001_000);
        $this->collect($sale, 'cash', null, 'y2-pay');
        $this->declare($today, 230, 0);
        $p = $this->preview($today);

        $this->assertSame(0, $p['lines'][0]['residual_milliliters']);
        $this->assertSame(230, $p['reference']['components']['earlier_shift_walk_in_collections_minor']);
        $this->assertSame(0, $p['reference']['components']['walk_in_erp_invoices_minor'], 'إجمالي فاتورة الأمس لا يُعدّ ثانيةً');
        $this->assertSame(230, $p['reference']['total_minor']);
        $this->assertSame(0, $p['declaration']['difference_vs_reference_minor']);
        $this->assertSame([], $p['allocation']['rows']);
        $this->assertSame([], $p['variances']['surplus']);
    }

    /** @test */
    public function a_named_customers_receipt_enters_the_reference_once_and_is_not_a_surplus(): void
    {
        $shift = $this->open('named');
        $this->meters($shift);
        $service = app(\App\Services\FuelSaleService::class);
        $sale = $service->finalize($service->createDraft([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $this->f['customer']->id, 'quantity_milliliters' => 20_000, 'idempotency_key' => 'named-sale',
        ], $this->f['actor']), $this->f['actor']);
        $this->collect($sale, 'cash', null, 'named-pay');
        $this->declare($shift, 4600);
        $p = $this->preview($shift);

        $this->assertSame(4600, $p['reference']['components']['named_customer_receipts_minor']);
        $this->assertSame(4600, $p['reference']['total_minor']);
        $this->assertSame(0, $p['declaration']['difference_vs_reference_minor']);
        $this->assertSame([], $p['allocation']['rows']);
        $this->assertSame([], $p['variances']['surplus']);
    }

    // ───────── الحجب (تكلفة / مجمّع / فترة) ─────────

    /** @test */
    public function a_cost_event_inside_the_window_withholds_the_line_and_the_declared_money_is_held_not_surplus(): void
    {
        $shift = $this->readyShift('w1', 4600);
        $movement = app(InventoryService::class)->applyReceipt($this->f['product'], 500000, 100, [
            'warehouse_id' => $this->f['warehouse']->id, 'source_type' => \App\Models\FuelProduct::class, 'source_id' => $this->f['fuelProduct']->id,
            'notes' => 'استلام أثناء الوردية', InventoryService::FUEL_POOL_META => true,
        ], 50000000);
        app(FuelCostBasisService::class)->recordReceipt($this->f['fuelProduct'], $this->f['warehouse'], $movement, 500000, 50000000);
        $p = $this->preview($shift);

        $this->assertSame('withheld_cost_pool_changed', $p['lines'][0]['state']);
        $this->assertSame(0, $p['reference']['components']['settlement_invoices_minor']);
        $this->assertSame(4600, $p['reference']['components']['withheld_pending_minor'], 'المحجوب لا يسقط من المرجع');
        $this->assertSame(0, $p['declaration']['difference_vs_reference_minor'], 'لا زيادة وهمية');
        $this->assertSame([], $p['allocation']['rows'], 'لا فاتورة تسنده');
        $this->assertSame([], $p['variances']['surplus']);
        $this->assertSame(4600, $p['variances']['held_for_withheld'][0]['amount_minor']);
        $this->assertSame([], $p['journal']);
    }

    /** @test */
    public function an_open_pool_history_withholds_a_later_shift_even_without_a_cost_event_in_its_own_window(): void
    {
        $shift = $this->readyShift('w2', 4600);
        $settlement = $this->seedWithheldHistory($shift);
        $this->assertNotNull($settlement);
        $p = $this->preview($shift);

        $this->assertSame('withheld_pool_history_open', $p['lines'][0]['state']);
        $this->assertSame(4600, $p['variances']['held_for_withheld'][0]['amount_minor']);
    }

    /** @test */
    public function a_shift_that_crosses_a_month_boundary_is_withheld_for_the_tax_opinion(): void
    {
        $shift = $this->readyShift('w3', 4600);
        $startOfLastMonth = now()->startOfMonth()->subMonthNoOverflow()->addDays(2);
        DB::table('fuel_shifts')->where('id', $shift->id)->update(['opened_at' => $startOfLastMonth]);
        $p = $this->preview($shift);

        $this->assertSame('withheld_period_boundary', $p['lines'][0]['state']);
        $this->assertSame(4600, $p['reference']['components']['withheld_pending_minor']);
    }

    /** @test */
    public function a_cost_event_in_another_station_sharing_the_pool_before_this_shift_opened_still_counts_in_the_exposure_window(): void
    {
        $other = \App\Models\FuelStation::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id,
            'code' => 'FCS-3', 'name' => 'محطة تشارك المخزن',
        ]);
        \App\Models\FuelTank::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $other->id, 'fuel_product_id' => $this->f['fuelProduct']->id,
            'code' => 'FCT-3', 'name' => 'خزان مشترك', 'capacity_milliliters' => 5000000, 'safe_capacity_milliliters' => 4500000,
        ]);
        // وردية المحطة الأخرى تفتح أولاً، ثم يقع استلام، ثم تُفتح ورديتنا بعده: الحدث خارج نافذة ورديتنا وحدها لكنه داخل نافذة التعرّض.
        $otherShift = app(FuelShiftService::class)->open(['fuel_station_id' => $other->id, 'opening_float_minor' => 0, 'idempotency_key' => 'other-open'], $this->f['actor']);
        $movement = app(InventoryService::class)->applyReceipt($this->f['product'], 500000, 100, [
            'warehouse_id' => $this->f['warehouse']->id, 'source_type' => \App\Models\FuelProduct::class, 'source_id' => $this->f['fuelProduct']->id,
            'notes' => 'استلام بعد فتح وردية المحطة الأخرى', InventoryService::FUEL_POOL_META => true,
        ], 50000000);
        app(FuelCostBasisService::class)->recordReceipt($this->f['fuelProduct'], $this->f['warehouse'], $movement, 500000, 50000000);
        $this->travel(2)->seconds();
        $shift = $this->readyShift('w4', 4600);
        $this->assertTrue($otherShift->opened_at->lt($shift->fresh()->opened_at));

        $p = $this->preview($shift);
        $this->assertSame('withheld_cost_pool_changed', $p['lines'][0]['state']);
    }

    // ───────── الموانع ─────────

    /** @test */
    public function missing_declaration_incomplete_meters_and_missing_walk_in_are_blockers_with_stable_codes(): void
    {
        $this->policyNone();
        $shift = $this->open('b1');
        $p = $this->preview($shift);
        $this->assertContains('FUEL_SETTLEMENT_METER_INCOMPLETE', $p['blockers']);
        $this->assertContains('FUEL_SETTLEMENT_DECLARATION_MISSING', $p['blockers']);
        $this->assertContains('FUEL_SETTLEMENT_NOT_READY_POLICY_NONE', $p['blockers'], 'السياسة none ⇒ غير جاهزة');
        $this->assertFalse($p['ready']);
    }

    /** @test */
    public function the_station_without_a_walk_in_partner_is_not_ready(): void
    {
        $other = \App\Models\FuelStation::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id,
            'code' => 'FCS-4', 'name' => 'محطة بلا عميل نقدي',
        ]);
        $blockers = app(\App\Services\FuelShiftSettlementReadiness::class)->stationBlockers($other);
        $this->assertContains('FUEL_SETTLEMENT_WALK_IN_REQUIRED', $blockers);
    }

    /** @test */
    public function erp_exceeding_the_meter_is_a_blocker_and_collapses_to_a_generic_code_for_viewers_without_sales_access(): void
    {
        $shift = $this->open('b2');
        $this->meters($shift, 1_000_000, 1_005_000);               // 5 لتر
        $this->walkInSale('b2-sale', $shift, 10_000);             // ERP 10 لتر > العدّاد
        $this->declare($shift, 0);

        $full = $this->preview($shift);
        $this->assertContains('FUEL_SETTLEMENT_ERP_EXCEEDS_METER', $full['blockers']);

        $seller = $this->preview($shift, $this->f['seller']);
        $this->assertNotContains('FUEL_SETTLEMENT_ERP_EXCEEDS_METER', $seller['blockers']);
        $this->assertContains('FUEL_SETTLEMENT_SUPERVISOR_ATTENTION', $seller['blockers']);
    }

    /** @test */
    public function a_price_change_blocks_only_while_residual_liters_remain(): void
    {
        $shift = $this->open('b3');
        $this->meters($shift);
        $this->declare($shift, 4600);
        app(\App\Services\FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $this->f['station']->id, 'fuel_product_id' => $this->f['fuelProduct']->id, 'price_per_liter_minor' => 250,
            'effective_from' => now()->addSecond()->toIso8601String(), 'supersede' => true,
        ], $this->f['actor']);
        $this->travel(5)->seconds();

        $this->assertContains('FUEL_SETTLEMENT_PRICE_CHANGED', $this->preview($shift)['blockers']);
    }

    /** @test */
    public function an_unstamped_receipt_blocks_the_preview(): void
    {
        // بوابة الختم مغلقة وقت التحصيل ⇒ إيصال بلا وردية ضمن نافذة هذه الوردية.
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $shift = $this->open('b4');
        $sale = $this->walkInSale('b4-sale', $shift, 1000);
        $this->collect($sale, 'cash', null, 'b4-pay');
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->meters($shift);
        $this->declare($shift, 230);

        $this->assertContains('FUEL_SETTLEMENT_RECEIPTS_UNATTRIBUTED', $this->preview($shift)['blockers']);
    }

    /** @test */
    public function a_non_open_shift_cannot_be_previewed(): void
    {
        $shift = $this->readyShift('b5', 4600);
        app(FuelShiftService::class)->close($shift->fresh(), 24600, null, $this->f['actor']);
        $this->rejects(fn () => $this->preview($shift));
    }

    // ───────── ثوابت الحساب (خصائص) ─────────

    /** @test */
    public function allocation_conserves_money_for_many_declarations_never_overpays_and_never_goes_negative(): void
    {
        $shift = $this->open('prop');
        $this->meters($shift);
        $sale = $this->walkInSale('prop-sale', $shift, 7_000);       // 7 لتر = 1610 غير مسدَّدة
        $targetsTotal = 1610 + 2990;                                  // + بقية 13 لتراً (20−7) = 2990
        mt_srand(20260);
        $revision = 0;
        foreach (range(1, 40) as $i) {
            [$cash, $bank] = [mt_rand(0, 6000), mt_rand(0, 6000)];
            $this->declare($shift, $cash, $bank, "p{$i}", $revision);
            $revision++;
            $p = $this->preview($shift);

            $allocated = $p['allocation']['allocated_total_minor'];
            $held = array_sum(array_column($p['variances']['held_for_withheld'], 'amount_minor'));
            $surplus = array_sum(array_column($p['variances']['surplus'], 'amount_minor'));
            $declared = $cash + $bank;

            $this->assertSame($declared, $allocated + $held + $surplus, "حفظ المال (نقد {$cash} + شبكة {$bank})");
            $this->assertLessThanOrEqual($targetsTotal, $allocated, 'لا يتجاوز الأهداف');
            $this->assertSame($targetsTotal - $allocated, $p['variances']['shortage_minor'], 'عجز = الأهداف − المخصَّص');
            $this->assertSame(0, $held, 'لا محجوب هنا');
            foreach ($p['allocation']['rows'] as $row) {
                $this->assertGreaterThan(0, $row['amount_minor']);
            }
            // لا فاتورة ERP تتجاوز متبقيها (1610) ولا فاتورة التسوية قيمتها (2990).
            $this->assertLessThanOrEqual(1610, (int) collect($p['allocation']['rows'])->where('target_kind', 'erp_walk_in')->sum('amount_minor'));
            $this->assertLessThanOrEqual(2990, (int) collect($p['allocation']['rows'])->where('target_kind', 'settlement')->sum('amount_minor'));
            // الفرق مع المرجع = المُقَرّ − (1610 + 3220).
            $this->assertSame($declared - $targetsTotal, $p['declaration']['difference_vs_reference_minor']);
        }
    }

    // ───────── حدود الشريحة: لا ترحيل عند الإغلاق ─────────

    /** @test */
    public function closing_a_shift_with_the_policy_on_still_posts_nothing_in_this_slice(): void
    {
        $shift = $this->readyShift('c1', 4600);
        $before = $this->writeCounts();

        app(FuelShiftService::class)->close($shift->fresh(), 24600, null, $this->f['actor']);

        $after = $this->writeCounts();
        foreach (['invoices', 'invoice_lines', 'journal_entries', 'journal_lines', 'payments', 'payment_allocations', 'stock_movements', 'fuel_sales', 'fuel_sale_payment_receipts',
            'fuel_inventory_cost_movements', 'fuel_operational_ledgers', 'partners', 'zatca_chain_entries', 'fuel_shift_settlements', 'fuel_shift_settlement_lines',
            'fuel_shift_settlement_collections', 'fuel_shift_settlement_variances', 'fuel_shift_settlement_resolutions', 'fuel_cost_pool_open_histories'] as $table) {
            $this->assertSame($before[$table], $after[$table], "{$table}: الإغلاق لا يرحّل شيئاً قبل P1-3b");
        }
        $this->assertSame('closed', $shift->fresh()->status);
    }

    /** @test */
    public function the_existing_close_and_sale_paths_do_not_reference_the_settlement_layer(): void
    {
        foreach (['FuelShiftService', 'FuelSaleService', 'FuelShiftCollectionService', 'FuelShiftCashExpectationService', 'FuelReconciliationService'] as $service) {
            $code = (string) file_get_contents(app_path("Services/{$service}.php"));
            $this->assertStringNotContainsString('FuelShiftSettlement', $code, "{$service} لا يستدعي طبقة التسوية في P1-3a");
            $this->assertStringNotContainsString('FuelStationWalkInPartner', $code, $service);
        }
        // لا كاتب لجداول التسوية خارج الاختبارات في هذه الشريحة (الكاتب FuelShiftSettlementService يأتي مع P1-3b).
        foreach (glob(app_path('Services/*.php')) as $file) {
            $this->assertStringNotContainsString("DB::table('fuel_shift_settlement", (string) file_get_contents($file), basename($file));
        }
        $this->assertFileDoesNotExist(app_path('Services/FuelShiftSettlementService.php'));
    }

    /** @test */
    public function a_method_enabled_after_the_declaration_with_a_receipt_is_checked_against_a_zero_declared_amount(): void
    {
        $shift = $this->open('late-method');
        $this->meters($shift);
        $sale = $this->walkInSale('late-sale', $shift, 1000);          // 230
        $this->declare($shift, 230, 0);

        // طريقة دفع جديدة تُفعَّل بعد حفظ الإقرار ويُسجَّل عليها مقبوض مختوم.
        $extra = \App\Models\PaymentMethod::create([
            'name' => 'طريقة لاحقة', 'settlement_type' => 'bank', 'cash_bank_account_id' => $this->f['bank']->cash_bank_account_id, 'is_active' => true,
        ]);
        $settings = app(FuelStationSettingsService::class);
        $allowed = $settings->get($this->f['station'], 'fuel_sales_allowed_payment_method_ids');
        $settings->putStationValues($this->f['station'], ['fuel_sales_allowed_payment_method_ids' => [...$allowed, $extra->id]], $this->f['actor'], 'تفعيل طريقة لاحقة');
        app(\App\Services\FuelSaleService::class)->collectPayment($sale->fresh(), ['payment_method_id' => $extra->id, 'amount_minor' => 230, 'idempotency_key' => 'late-pay'], $this->f['actor']);

        $p = $this->preview($shift);
        $this->assertContains('FUEL_SETTLEMENT_DECLARATION_BELOW_RECEIPTS', $p['blockers']);
        $this->assertFalse($p['ready']);
    }

    /** @test */
    public function simulated_cost_quotes_carry_the_fractional_remainder_between_nozzles_like_real_sequential_issues(): void
    {
        // 0.6 هللة لكل مل: صرف 1 مل مرتين ⇒ 0 ثم 1 (الباقي الكسري يُحمل). إعادة قراءة الحالة لكل فوهة كانت تعطي 0 و0.
        DB::table('fuel_inventory_cost_states')->where('warehouse_id', $this->f['warehouse']->id)->update(['cost_numerator_minor' => '3', 'cost_denominator' => '5']);
        $before = (array) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $this->f['warehouse']->id)->first();
        $costs = app(FuelCostBasisService::class);

        $sequence = $costs->previewIssueSequence($this->f['fuelProduct'], $this->f['warehouse'], [1, 1, 1]);
        // الباقي المحمول: 0.6 → 0 (يبقى 0.6) ؛ 0.6+0.6=1.2 → 1 (يبقى 0.2) ؛ 0.2+0.6=0.8 → 0 (يبقى 0.8).
        $this->assertSame([0, 1, 0], array_map(fn ($q) => $q['posted_cost_minor'], $sequence));
        $this->assertSame(0, $costs->previewIssue($this->f['fuelProduct'], $this->f['warehouse'], 1)['posted_cost_minor'], 'صرف منفرد');
        $this->assertEquals($before, (array) DB::table('fuel_inventory_cost_states')->where('warehouse_id', $this->f['warehouse']->id)->first(), 'الحالة المخزَّنة لا تُمسّ');
    }

    /** @test */
    public function a_product_deactivated_during_the_shift_blocks_instead_of_silently_dropping_its_residual(): void
    {
        $shift = $this->readyShift('inactive-product', 4600);
        $this->f['fuelProduct']->forceFill(['is_active' => false])->save();

        $p = $this->preview($shift);
        $this->assertContains('FUEL_SETTLEMENT_PRODUCT_UNAVAILABLE', $p['blockers']);
        $this->assertFalse($p['ready']);
        $this->assertNull($p['lines'][0]['expected_gross_minor']);
    }

    /** @test */
    public function a_payment_method_removed_after_the_declaration_blocks_until_it_is_saved_again(): void
    {
        $shift = $this->readyShift('removed-method', 2000, 2600);
        app(FuelStationSettingsService::class)->putStationValues(
            $this->f['station'], ['fuel_sales_allowed_payment_method_ids' => [$this->f['cash']->id]], $this->f['actor'], 'إزالة الشبكة',
        );

        $p = $this->preview($shift);
        $this->assertContains('FUEL_SETTLEMENT_DECLARATION_METHODS_CHANGED', $p['blockers']);
        $this->assertFalse($p['ready']);
    }

    // ───────── طبقات الإفصاح ─────────

    /** @test */
    public function the_disclosure_layers_hide_amounts_without_sales_access_and_costs_without_cost_access(): void
    {
        $shift = $this->readyShift('d1', 4600);

        $basic = $this->preview($shift, $this->f['seller']);
        foreach (['reference', 'declaration', 'allocation', 'variances', 'journal'] as $key) {
            $this->assertArrayNotHasKey($key, $basic, "{$key} مالي");
        }
        $this->assertArrayHasKey('preview_hash', $basic, 'من يملك الإغلاق يملك البصمة');
        $this->assertArrayNotHasKey('expected_gross_minor', $basic['lines'][0]);
        $this->assertArrayNotHasKey('erp_milliliters', $basic['lines'][0]);

        $finance = $this->preview($shift, $this->finance('fin'));
        $this->assertArrayHasKey('reference', $finance);
        $this->assertArrayNotHasKey('cost_minor', $finance['lines'][0], 'التكلفة مفتاح محذوف لا قيمة مخفاة');
        $this->assertNotContains('J2', array_column($finance['journal'], 'id'));

        $costly = $this->preview($shift, $this->finance('cost', true));
        $this->assertArrayHasKey('cost_minor', $costly['lines'][0]);
        $this->assertContains('J2', array_column($costly['journal'], 'id'));
        // تكلفة الـfixture: 100,000,000 هللة لكل 1,000,000 مل ⇒ 100 هللة/مل ⇒ 20,000 مل = 2,000,000 هللة.
        $this->assertSame(2_000_000, collect($costly['journal'])->firstWhere('id', 'J2')['lines'][0]['amount_minor']);

        // البصمة واحدة لكل المستخدمين (تُغطّي كل ما سيُرحَّل) ولا تكشف منه شيئاً.
        $this->assertSame($basic['preview_hash'], $finance['preview_hash']);
        $this->assertSame($finance['preview_hash'], $costly['preview_hash']);
    }

    /** @test */
    public function the_preview_hash_is_stable_changes_with_the_inputs_and_is_a_keyed_hmac(): void
    {
        $shift = $this->readyShift('h1', 4600);
        $first = $this->preview($shift)['preview_hash'];
        $this->assertSame($first, $this->preview($shift)['preview_hash'], 'مستقرة لنفس الحالة');
        $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $first);

        $this->declare($shift, 4000, 0, 'decl2', 1);
        $this->assertNotSame($first, $this->preview($shift)['preview_hash'], 'تتغيّر بتغيّر الإقرار');

        // ليست SHA-256 مجرداً لمحتوى قابل للتخمين.
        $this->assertNotSame(hash('sha256', $shift->id), $first);
    }

    /** @test */
    public function the_seller_route_works_over_http_with_the_close_permission_and_denies_without_it(): void
    {
        $shift = $this->readyShift('p1', 4600);
        $sellerToken = $this->f['seller']->createToken('t')->plainTextToken;
        $this->withToken($sellerToken)->getJson(self::BASE."/{$shift->id}/settlement-preview")->assertOk()
            ->assertJsonMissingPath('data.reference')->assertJsonPath('data.writes_nothing', true);

        $viewer = $this->roleUser($this->f['tenant_id'], 'view-only', 'view-only@settlement.test', ['fuel.shift.view']);
        $this->withToken($viewer->createToken('t')->plainTextToken)->getJson(self::BASE."/{$shift->id}/settlement-preview")->assertForbidden();

        $foreign = $this->foreignToken('foreign-owner2@settlement.test');
        $this->withToken($foreign)->getJson(self::BASE."/{$shift->id}/settlement-preview")->assertNotFound();
    }

    // ───────── حارس عدم الكتابة (ساكن) ─────────

    /** @test */
    public function the_preview_path_contains_no_writer_calls(): void
    {
        $forbiddenCalls = [
            'InvoiceService', 'PaymentService', 'LedgerService', 'InventoryService', 'FuelSaleService', 'recordIssue', 'recordReceipt', 'assertReady',
            '::create(', '->create(', '->save(', '->update(', '->delete(', '->insert(', 'DB::table', 'DB::statement', 'DB::transaction', 'lockForUpdate', 'sharedLock',
            'lockAnchor', 'activeLockFor', 'assertOpen',
        ];
        foreach ([
            app_path('Services/FuelShiftSettlementPreviewService.php'),
            app_path('Services/FuelShiftSettlementReadiness.php'),
            app_path('Http/Controllers/Api/FuelShiftSettlementPreviewController.php'),
        ] as $path) {
            $code = preg_replace('#/\*.*?\*/|//[^\n]*#s', '', (string) file_get_contents($path));
            foreach ($forbiddenCalls as $needle) {
                $this->assertStringNotContainsString($needle, $code, basename($path)." يستدعي {$needle}");
            }
        }
    }

    // ───────── مساعد: تاريخ مفتوح للمجمّع (يُدرج بـSQL خام لأن الكاتب غير موجود قبل P1-3b) ─────────

    private function seedWithheldHistory(FuelShift $shift): ?string
    {
        // وردية سابقة مغلقة (خام) بتسوية محجوبة وتاريخ مفتوح على المجمّع.
        $past = $this->uuid();
        DB::table('fuel_shifts')->insert([
            'id' => $past, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'number' => 'FSH-PAST', 'idempotency_key' => 'past-shift', 'status' => 'closed', 'opening_float_minor' => 0, 'operational_meter_milliliters' => 0, 'operational_delivery_milliliters' => 0,
            'opened_at' => now()->subDays(2), 'closed_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $settlement = $this->uuid();
        DB::table('fuel_shift_settlements')->insert([
            'id' => $settlement, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'fuel_shift_id' => $past, 'status' => 'withheld', 'sales_basis' => 'per_invoice', 'preview_hash' => str_repeat('c', 64),
            'policy_snapshot' => json_encode([]), 'metered_milliliters' => 1000, 'erp_milliliters' => 0, 'residual_milliliters' => 1000,
            'settled_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        $line = $this->uuid();
        DB::table('fuel_shift_settlement_lines')->insert([
            'id' => $line, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlement,
            'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_product_id' => $this->f['fuelProduct']->id, 'warehouse_id' => $this->f['warehouse']->id,
            'metered_milliliters' => 1000, 'erp_milliliters' => 0, 'residual_milliliters' => 1000, 'state' => 'withheld_cost_pool_changed',
            'withheld_reason' => 'withheld_cost_pool_changed', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('fuel_cost_pool_open_histories')->insert([
            'id' => $this->uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'warehouse_id' => $this->f['warehouse']->id, 'fuel_product_id' => $this->f['fuelProduct']->id, 'fuel_shift_settlement_line_id' => $line,
            'reason' => 'withheld_cost_pool_changed', 'opened_at' => now()->subDay(), 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $settlement;
    }

    private function uuid(): string
    {
        return (string) \Illuminate\Support\Str::uuid();
    }
}

<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelDelivery;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelSupplierInvoice;
use App\Models\FuelSupplierInvoiceMatch;
use App\Models\FuelTank;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FUEL-B1 — تحصين دورة الاستلام (بلا هجرة):
 *  - FS-16: إعادة المفتاح بحمولة مختلفة تُرفض (استلام / فاتورة مورد / مطابقة) وبالحمولة نفسها تُعيد الأصل.
 *  - حجب القيم المالية (تكلفة الاستلام، قيم الفاتورة والمطابقة، تكلفة التسوية) عن غير حاملي `products.view_cost`.
 *  - نطاق عرض فواتير الموردين للمستخدم المقيَّد بفرع/مخزن.
 */
class FuelReceivingHardeningTest extends TestCase
{
    use RefreshDatabase;
    use GivesFuelDeliveryCost;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    // ───────────────────────── FS-16: الاستلام ─────────────────────────

    /** @test */
    public function a_delivery_replay_returns_the_original_and_any_changed_content_is_rejected_without_leaking_values(): void
    {
        $f = $this->fixture();
        $payload = $this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'b1-dlv-1');

        $first = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $payload)->assertCreated()->json('data');
        $replay = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $payload)->assertOk()->json('data');
        $this->assertSame($first['id'], $replay['id']);

        foreach ([
            ['received_total_cost_minor' => 987654],
            ['received_liters' => '11.000'],
            ['dispatched_liters' => '9.000'],
            ['delivery_note_number' => 'DN-changed'],
            ['tanker_identifier' => 'TNK-77'],
            ['notes' => 'ملاحظة مغيَّرة'],
            ['fuel_tank_id' => $f['tank_a2']->id],
        ] as $change) {
            $response = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $change + $payload)->assertStatus(422);
            $this->assertStringContainsString('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH', (string) $response->json('message'), json_encode($change));
            // الرسالة تسمّي الحقل ولا تُسرّب قيمة السجل الأصلي (التكلفة).
            $this->assertStringNotContainsString('2345', (string) $response->json('message'));
        }

        $this->assertSame(1, FuelDelivery::count());
        $stored = FuelDelivery::sole();
        $this->assertSame(2345, (int) $stored->received_total_cost_minor);
        $this->assertSame(10000, (int) $stored->received_milliliters);
    }

    /** @test */
    public function replaying_an_approved_delivery_returns_it_without_a_second_stock_movement_or_entry(): void
    {
        $f = $this->fixture();
        $payload = $this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'b1-dlv-approved');
        $delivery = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $payload)->assertCreated()->json('data');
        $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk();
        $movements = StockMovement::count();
        $entries = JournalEntry::count();

        $replay = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $payload)->assertOk()->json('data');

        $this->assertSame($delivery['id'], $replay['id']);
        $this->assertSame('approved', $replay['status']);
        $this->assertSame($movements, StockMovement::count());
        $this->assertSame($entries, JournalEntry::count());
    }

    /** @test */
    public function a_duplicate_delivery_note_for_the_same_supplier_is_a_clear_422_not_a_server_error(): void
    {
        $f = $this->fixture();
        $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'b1-note-1'))->assertCreated();

        $second = $this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'b1-note-2');
        $second['delivery_note_number'] = 'DN-b1-note-1';
        $response = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $second)->assertStatus(422);

        $this->assertStringContainsString('FUEL_DELIVERY_DUPLICATE', (string) $response->json('message'));
        $this->assertSame(1, FuelDelivery::count());
    }

    // ───────────────────────── FS-16: فاتورة المورد ─────────────────────────

    /** @test */
    public function a_supplier_invoice_replay_returns_the_original_and_changed_content_is_rejected(): void
    {
        $f = $this->fixture();
        $payload = $this->invoicePayload($f, 'B1-INV-1');

        $first = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices', $payload)->assertOk()->json('data');
        $replay = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices', $payload)->assertOk()->json('data');
        $this->assertSame($first['id'], $replay['id']);
        $this->assertCount(1, $replay['lines']); // الإعادة تحمل السطور أيضاً

        $changedValue = $payload;
        $changedValue['lines'][0]['value_minor'] = 5000;
        $changedQuantity = $payload;
        $changedQuantity['lines'][0]['quantity_liters'] = '12.000';
        $extraLine = $payload;
        $extraLine['lines'][] = ['fuel_product_id' => $f['fuel']->id, 'quantity_liters' => '1.000', 'value_minor' => 100];

        foreach ([$changedValue, $changedQuantity, $extraLine, ['currency' => 'USD'] + $payload, ['notes' => 'ملاحظة جديدة'] + $payload] as $changed) {
            $response = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices', $changed)->assertStatus(422);
            $this->assertStringContainsString('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH', (string) $response->json('message'));
        }

        $this->assertSame(1, FuelSupplierInvoice::count());
        $this->assertSame(2345, (int) FuelSupplierInvoice::sole()->total_value_minor);
    }

    // ───────────────────────── FS-16: المطابقة ─────────────────────────

    /** @test */
    public function a_match_replay_returns_the_original_but_a_different_content_under_the_same_key_is_rejected(): void
    {
        $f = $this->fixture();
        [$invoice, $delivery] = $this->approvedDeliveryAndInvoice($f, 'b1-m1', 'B1-INV-M1');
        $payload = $this->matchPayload($invoice, $delivery, '5.000', 'b1-match-key');

        $first = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $invoice['id'] . '/matches', $payload)->assertCreated()->json('data');
        $entries = JournalEntry::count();
        $replay = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $invoice['id'] . '/matches', $payload)->assertOk()->json('data');
        $this->assertSame($first['id'], $replay['id']);
        $this->assertSame($entries, JournalEntry::count());

        $response = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $invoice['id'] . '/matches', ['quantity_liters' => '4.000'] + $payload)->assertStatus(422);
        $this->assertStringContainsString('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH', (string) $response->json('message'));

        $this->assertSame(1, FuelSupplierInvoiceMatch::count());
        $this->assertSame(5000, (int) FuelSupplierInvoiceMatch::sole()->matched_quantity_milliliters);
    }

    /** @test */
    public function the_same_match_key_on_another_invoice_is_never_answered_with_the_first_invoices_match(): void
    {
        $f = $this->fixture();
        [$invoiceOne, $delivery] = $this->approvedDeliveryAndInvoice($f, 'b1-m2', 'B1-INV-M2A');
        $invoiceTwo = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices', $this->invoicePayload($f, 'B1-INV-M2B'))->assertOk()->json('data');

        $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $invoiceOne['id'] . '/matches', $this->matchPayload($invoiceOne, $delivery, '5.000', 'b1-shared-key'))->assertCreated();
        $entries = JournalEntry::count();

        $response = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $invoiceTwo['id'] . '/matches', $this->matchPayload($invoiceTwo, $delivery, '5.000', 'b1-shared-key'))->assertStatus(422);

        $this->assertStringContainsString('FUEL_IDEMPOTENCY_PAYLOAD_MISMATCH', (string) $response->json('message'));
        $this->assertSame(1, FuelSupplierInvoiceMatch::count());
        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame(0, (int) FuelSupplierInvoice::findOrFail($invoiceTwo['id'])->matched_quantity_milliliters);
    }

    // ───────────────────────── حجب القيم المالية ─────────────────────────

    /** @test */
    public function receiving_values_are_removed_entirely_without_the_cost_permission_and_present_with_it(): void
    {
        $f = $this->fixture();
        [$invoice, $delivery] = $this->approvedDeliveryAndInvoice($f, 'b1-cost', 'B1-INV-COST');
        $match = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $invoice['id'] . '/matches', $this->matchPayload($invoice, $delivery, '10.000', 'b1-cost-match'))->assertCreated()->json('data');

        $deliveryKeys = ['received_total_cost_minor'];
        $invoiceKeys = ['total_value_minor', 'matched_value_minor'];
        $lineKeys = ['value_minor', 'matched_value_minor'];
        $matchKeys = ['matched_receipt_value_minor', 'matched_invoice_value_minor', 'cleared_value_minor', 'value_variance_minor', 'variance_direction'];

        foreach (['owner', 'cost_manager'] as $who) {
            $token = $f[$who];
            $this->assertHasKeys($deliveryKeys, $this->withToken($token)->getJson(self::BASE . '/deliveries/' . $delivery['id'])->assertOk()->json('data'));
            $this->assertHasKeys($deliveryKeys, $this->withToken($token)->getJson(self::BASE . '/deliveries')->assertOk()->json('data.0'));
            $shown = $this->withToken($token)->getJson(self::BASE . '/supplier-invoices/' . $invoice['id'])->assertOk()->json('data');
            $this->assertHasKeys($invoiceKeys, $shown);
            $this->assertHasKeys($lineKeys, $shown['lines'][0]);
        }
        $this->assertHasKeys($matchKeys, $match);

        // مدير الوقود بلا `products.view_cost` (وهو ما يملكه البائع/المشرف عملياً): كل القيم محذوفة كاملةً لا مصفَّرة.
        $token = $f['plain_manager'];
        $this->assertLacksKeys($deliveryKeys, $this->withToken($token)->getJson(self::BASE . '/deliveries/' . $delivery['id'])->assertOk()->json('data'));
        $this->assertLacksKeys($deliveryKeys, $this->withToken($token)->getJson(self::BASE . '/deliveries')->assertOk()->json('data.0'));
        $list = $this->withToken($token)->getJson(self::BASE . '/supplier-invoices')->assertOk()->json('data.0');
        $this->assertLacksKeys($invoiceKeys, $list);
        $this->assertLacksKeys($lineKeys, $list['lines'][0]);
        $shown = $this->withToken($token)->getJson(self::BASE . '/supplier-invoices/' . $invoice['id'])->assertOk()->json('data');
        $this->assertLacksKeys($invoiceKeys, $shown);
        $this->assertLacksKeys($lineKeys, $shown['lines'][0]);
        // الحقول التشغيلية باقية (كمية/حالة).
        $this->assertSame('10', $shown['total_quantity_liters'] ?? null);
        $this->assertArrayHasKey('status', $shown);

        // استجابات الكتابة تُحجب كذلك: إنشاء استلام جديد ومطابقة جديدة.
        $created = $this->withToken($token)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'b1-cost-2')))->assertCreated()->json('data');
        $this->setCostDirectly($created['id']);
        $this->assertLacksKeys($deliveryKeys, $created);
        $this->assertLacksKeys($deliveryKeys, $this->withToken($token)->postJson(self::BASE . '/deliveries', $this->withoutCost($this->deliveryPayload($f, $f['station_a'], $f['tank_a'], $f['warehouse_a'], 'b1-cost-2')))->assertOk()->json('data'));
        $this->assertLacksKeys($deliveryKeys, $this->withToken($token)->postJson(self::BASE . '/deliveries/' . $created['id'] . '/approve')->assertOk()->json('data'));
        $second = $this->withToken($token)->postJson(self::BASE . '/supplier-invoices', $this->invoicePayload($f, 'B1-INV-COST-2'))->assertOk()->json('data');
        $this->assertLacksKeys($invoiceKeys, $second);
        $newMatch = $this->withToken($token)->postJson(self::BASE . '/supplier-invoices/' . $second['id'] . '/matches', $this->matchPayload($second, $created, '10.000', 'b1-cost-match-2'))->assertCreated()->json('data');
        $this->assertLacksKeys($matchKeys, $newMatch);
        $this->assertArrayHasKey('status', $newMatch);
    }

    /** @test */
    public function reconciliation_unit_cost_and_financial_variance_need_the_cost_permission(): void
    {
        $f = $this->fixture();
        $this->withToken($f['owner'])->postJson(self::BASE . '/readings', [
            'fuel_station_id' => $f['station_a']->id, 'fuel_tank_id' => $f['tank_a']->id, 'reading_type' => 'physical',
            'quantity_liters' => '0', 'evidence_key' => 'b1-recon-ev',
        ])->assertCreated();
        $draft = $this->withToken($f['owner'])->postJson(self::BASE . '/reconciliations', [
            'fuel_station_id' => $f['station_a']->id, 'fuel_tank_id' => $f['tank_a']->id,
        ])->assertCreated()->json('data');

        $this->assertArrayHasKey('unit_cost_minor', $this->withToken($f['cost_manager'])->getJson(self::BASE . '/reconciliations')->assertOk()->json('data.0.settlement'));
        $this->assertArrayHasKey('financial_variance_minor', $this->withToken($f['cost_manager'])->getJson(self::BASE . '/reconciliations')->assertOk()->json('data.0.settlement'));

        $plain = $this->withToken($f['plain_manager'])->getJson(self::BASE . '/reconciliations')->assertOk()->json('data.0');
        $this->assertSame($draft['id'], $plain['id']);
        $this->assertArrayNotHasKey('unit_cost_minor', $plain['settlement']);
        $this->assertArrayNotHasKey('financial_variance_minor', $plain['settlement']);
        $this->assertArrayHasKey('status', $plain);
    }

    // ───────────────────────── نطاق فواتير الموردين ─────────────────────────

    /** @test */
    public function a_restricted_user_sees_only_invoices_they_created_or_matched_inside_their_stations_and_never_a_mixed_one(): void
    {
        $f = $this->fixture();
        $restricted = $f['warehouse_user'];

        // فاتورة المالك غير المطابَقة: لا محطة تحدّد من يملكها ⇒ مخفية عن المقيَّد (فشل مغلق).
        $unmatchedOwner = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices', $this->invoicePayload($f, 'B1-SCOPE-UNMATCHED'))->assertOk()->json('data');
        // فاتورة المقيَّد نفسه غير المطابَقة: يراها (وإلا لما استطاع مطابقة ما أنشأه).
        $own = $this->withToken($restricted)->postJson(self::BASE . '/supplier-invoices', $this->invoicePayload($f, 'B1-SCOPE-OWN'))->assertOk()->json('data');
        // فاتورة مطابَقة على محطة داخل نطاقه (مخزن A) ⇒ مرئية.
        [$inScope, $deliveryA] = $this->approvedDeliveryAndInvoice($f, 'b1-scope-a', 'B1-SCOPE-IN', $f['station_a'], $f['tank_a'], $f['warehouse_a']);
        $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $inScope['id'] . '/matches', $this->matchPayload($inScope, $deliveryA, '10.000', 'b1-scope-in'))->assertCreated();
        // فاتورة مطابَقة على محطة خارج نطاقه (مخزن A2) ⇒ مخفية.
        [$outScope, $deliveryA2] = $this->approvedDeliveryAndInvoice($f, 'b1-scope-a2', 'B1-SCOPE-OUT', $f['station_a2'], $f['tank_a2'], $f['warehouse_a2']);
        $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $outScope['id'] . '/matches', $this->matchPayload($outScope, $deliveryA2, '10.000', 'b1-scope-out'))->assertCreated();
        // فاتورة مختلطة (مطابقة داخل النطاق وأخرى خارجه) أنشأها المقيَّد نفسه ⇒ مخفية: إجمالياتها تكشف محطة لا يراها.
        [$mixedDeliveryA, $mixedDeliveryA2] = [$this->approvedDelivery($f, 'b1-mixed-a', $f['station_a'], $f['tank_a'], $f['warehouse_a']), $this->approvedDelivery($f, 'b1-mixed-a2', $f['station_a2'], $f['tank_a2'], $f['warehouse_a2'])];
        $mixed = $this->withToken($restricted)->postJson(self::BASE . '/supplier-invoices', $this->invoicePayload($f, 'B1-SCOPE-MIXED', '20.000', 4690))->assertOk()->json('data');
        $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $mixed['id'] . '/matches', $this->matchPayload($mixed, $mixedDeliveryA, '10.000', 'b1-mixed-1'))->assertCreated();
        $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices/' . $mixed['id'] . '/matches', $this->matchPayload($mixed, $mixedDeliveryA2, '10.000', 'b1-mixed-2'))->assertCreated();

        $visible = collect($this->withToken($restricted)->getJson(self::BASE . '/supplier-invoices')->assertOk()->json('data'))->pluck('invoice_number')->sort()->values()->all();
        $this->assertSame(['B1-SCOPE-IN', 'B1-SCOPE-OWN'], $visible);

        $this->withToken($restricted)->getJson(self::BASE . '/supplier-invoices/' . $own['id'])->assertOk();
        $this->withToken($restricted)->getJson(self::BASE . '/supplier-invoices/' . $inScope['id'])->assertOk();
        foreach ([$unmatchedOwner, $outScope, $mixed] as $hidden) {
            $this->withToken($restricted)->getJson(self::BASE . '/supplier-invoices/' . $hidden['id'])->assertNotFound();
        }

        // المطابقة تحترم النطاق نفسه: فاتورة مخفية ⇒ 404 قبل أي أثر.
        $matches = FuelSupplierInvoiceMatch::count();
        $this->withToken($restricted)->postJson(self::BASE . '/supplier-invoices/' . $unmatchedOwner['id'] . '/matches', $this->matchPayload($unmatchedOwner, $deliveryA, '1.000', 'b1-hidden-match'))->assertNotFound();
        $this->assertSame($matches, FuelSupplierInvoiceMatch::count());

        // غير المقيَّد يرى الجميع.
        $this->assertCount(5, $this->withToken($f['owner'])->getJson(self::BASE . '/supplier-invoices')->assertOk()->json('data'));
        $this->assertCount(5, $this->withToken($f['plain_manager'])->getJson(self::BASE . '/supplier-invoices')->assertOk()->json('data'));
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @param list<string> $keys @param array<string,mixed> $payload */
    private function assertHasKeys(array $keys, array $payload): void
    {
        foreach ($keys as $key) {
            $this->assertArrayHasKey($key, $payload, "المفتاح {$key} مفقود");
        }
    }

    /** @param list<string> $keys @param array<string,mixed> $payload */
    private function assertLacksKeys(array $keys, array $payload): void
    {
        foreach ($keys as $key) {
            $this->assertArrayNotHasKey($key, $payload, "المفتاح {$key} يجب أن يُحذف كاملاً");
        }
    }

    /** @return array<string,mixed> */
    private function approvedDelivery(array $f, string $key, FuelStation $station, FuelTank $tank, Warehouse $warehouse): array
    {
        $delivery = $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($f, $station, $tank, $warehouse, $key))->assertCreated()->json('data');
        $this->withToken($f['owner'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk();

        return $delivery;
    }

    /**
     * @return array{0:array<string,mixed>,1:array<string,mixed>} [invoice, delivery]
     */
    private function approvedDeliveryAndInvoice(array $f, string $deliveryKey, string $invoiceNumber, ?FuelStation $station = null, ?FuelTank $tank = null, ?Warehouse $warehouse = null): array
    {
        $delivery = $this->approvedDelivery($f, $deliveryKey, $station ?? $f['station_a'], $tank ?? $f['tank_a'], $warehouse ?? $f['warehouse_a']);
        $invoice = $this->withToken($f['owner'])->postJson(self::BASE . '/supplier-invoices', $this->invoicePayload($f, $invoiceNumber))->assertOk()->json('data');

        return [$invoice, $delivery];
    }

    /** @return array<string,mixed> */
    private function matchPayload(array $invoice, array $delivery, string $liters, string $key): array
    {
        return [
            'fuel_supplier_invoice_line_id' => $invoice['lines'][0]['id'],
            'fuel_delivery_id' => $delivery['id'],
            'quantity_liters' => $liters,
            'idempotency_key' => $key,
        ];
    }

    /** @return array<string,mixed> */
    private function invoicePayload(array $f, string $number, string $liters = '10.000', int $value = 2345): array
    {
        return [
            'supplier_id' => $f['supplier']->id, 'invoice_number' => $number, 'invoice_date' => '2026-08-23', 'currency' => 'SAR',
            'lines' => [['fuel_product_id' => $f['fuel']->id, 'quantity_liters' => $liters, 'value_minor' => $value]],
        ];
    }

    /** @return array<string,mixed> */
    private function deliveryPayload(array $f, FuelStation $station, FuelTank $tank, Warehouse $warehouse, string $key): array
    {
        return [
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $f['fuel']->id,
            'warehouse_id' => $warehouse->id, 'supplier_id' => $f['supplier']->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345,
            'delivery_note_number' => 'DN-' . $key, 'idempotency_key' => $key,
        ];
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        $auth = $this->registerTenant('fuel-b1', 'owner@fuel-b1.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_b1', reason: 'اختبار تحصين الاستلام B1.',
        );

        $branch = Branch::where('is_main', true)->firstOrFail();
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-B1-A2', 'branch_id' => $branch->id]);

        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وقود B1 mL', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-B1', 'name' => 'وقود B1']);

        $mk = function (Warehouse $warehouse, string $code) use ($branch, $fuel) {
            $station = FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]);
            $tank = FuelTank::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 200000, 'safe_capacity_milliliters' => 190000,
            ]);

            return [$station, $tank];
        };
        [$stationA, $tankA] = $mk($warehouseA, 'B1A');
        [$stationA2, $tankA2] = $mk($warehouseA2, 'B1A2');

        $supplier = Partner::create(['branch_id' => $branch->id, 'type' => 'supplier', 'name' => 'مورد B1', 'is_active' => true]);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI B1', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        $this->withToken($auth['token'])->putJson(self::BASE . '/settings', ['grni_account_id' => $grni->id, 'reason' => 'GRNI لاختبار B1'])->assertOk();

        $plainRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-b1-plain', 'name' => 'مدير وقود بلا تكلفة',
            'permissions' => ['fuel_stations.view', 'fuel_stations.manage'], 'is_system' => false,
        ]);
        $costRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-b1-cost', 'name' => 'مدير وقود مع التكلفة',
            'permissions' => ['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost'], 'is_system' => false,
        ]);
        $user = fn (string $name, string $slug) => User::create([
            'tenant_id' => $tenantId, 'name' => $name, 'email' => "{$name}@fuel-b1.test", 'password' => 'password123', 'role' => $slug,
        ]);
        $plain = $user('plain', $plainRole->slug);
        $cost = $user('cost', $costRole->slug);
        $restricted = $user('restricted', $plainRole->slug);
        $restricted->warehouses()->attach($warehouseA->id);

        return [
            'owner' => $auth['token'],
            'plain_manager' => $plain->createToken('api')->plainTextToken,
            'cost_manager' => $cost->createToken('api')->plainTextToken,
            'warehouse_user' => $restricted->createToken('api')->plainTextToken,
            'fuel' => $fuel, 'supplier' => $supplier,
            'station_a' => $stationA, 'tank_a' => $tankA, 'warehouse_a' => $warehouseA,
            'station_a2' => $stationA2, 'tank_a2' => $tankA2, 'warehouse_a2' => $warehouseA2,
        ];
    }
}

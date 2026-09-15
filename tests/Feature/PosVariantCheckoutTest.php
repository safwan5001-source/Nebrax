<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\InventoryState;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Models\ProductVariant;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\Accounting\InventoryService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-POS-1 — اختيار المتغيّر وحلّ الباركود والإتمام في نقطة البيع
 * ═══════════════════════════════════════════════════════════════
 *  يغطّي: كتالوج POS يعرض المتغيّرات النشطة بسعرها، حلّ الباركود الخادمي
 *  (منتج/متغيّر/وحدة/سعرٌ معياري)، حواجز الإتمام (تركيبة خاطئة/عزل مستأجر/
 *  متغيّرٌ معطَّل)، توجيه المخزون إلى هويّة المتغيّر الصحيحة مع عزل الأشقاء،
 *  استقلالية idempotency عن تبديل المتغيّر، وحفظ الهويّة عبر تعليق/استئناف البيع.
 */
class PosVariantCheckoutTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    private ?string $lastWarehouseId = null;

    private function openSession(array $auth, int $openingBalance = 0): string
    {
        $n = ++$this->deviceSequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن بيع {$n}", 'code' => "POS-V-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $this->lastWarehouseId = $warehouseId;
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير بيع {$n}", 'code' => "POS-V-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
            'pos_device_id'  => $deviceId,
        ])->assertCreated()['data']['id'];
    }

    private function methods(array $auth): array
    {
        return $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk()['data'];
    }

    private function methodBySettlement(array $methods, string $settlementType): array
    {
        foreach ($methods as $method) {
            if ($method['settlement_type'] === $settlementType) {
                return $method;
            }
        }
        throw new \RuntimeException("لا توجد وسيلة دفع بنوع تسوية {$settlementType}.");
    }

    private function tender(array $method, int $amount): array
    {
        return ['payment_method_id' => $method['id'], 'amount' => $amount];
    }

    private function checkout(string $token, string $partnerId, string $sessionId, array $tenders, array $items, ?string $idempotencyKey = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson('/api/pos/checkout', [
            'idempotency_key' => $idempotencyKey ?? (string) Str::uuid(),
            'partner_id'     => $partnerId,
            'pos_session_id' => $sessionId,
            'items'          => $items,
            'tenders'        => $tenders,
        ]);
    }

    /** منتجٌ متعدد الخيارات بمتغيّرين: أسود/كبير وأبيض/صغير — سعرٌ صريحٌ لكلٍّ منهما. */
    private function variantManagedProduct(string $sku = 'SHIRT-1'): array
    {
        $tenantId = app(TenantContext::class)->id();
        $product = Product::create([
            'name' => 'قميص', 'sku' => $sku, 'sale_price' => 20000, 'track_inventory' => true,
        ]);

        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);

        $size = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $large = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'كبير', 'value_key' => 'كبير', 'sort_order' => 0]);
        $small = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'صغير', 'value_key' => 'صغير', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();

        $black1 = $variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $white1 = $variants->createSingleVariant($product, [$white->id, $small->id], null)['variant'];

        // VAR-PRICE-1: سعرٌ صريحٌ لكلٍّ منهما — وإلا `posPriceFor()` تسقط على ٠.
        $black1->unitPrices()->create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'unit_name' => $product->unit, 'price' => 20000]);
        $white1->unitPrices()->create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'unit_name' => $product->unit, 'price' => 22000]);

        return [$product->fresh(), $black1->fresh(), $white1->fresh()];
    }

    // ───────────────────────── ١) كتالوج POS ─────────────────────────

    /** @test */
    public function pos_catalog_exposes_active_variants_with_their_own_price(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black, $white] = $this->variantManagedProduct();
        $white->update(['is_active' => false]);

        $catalog = $this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'];
        $shown = collect($catalog)->firstWhere('id', $product->id);

        $this->assertCount(1, $shown['pos_variants'], 'المتغيّر المعطَّل لا يظهر كخيارٍ قابلٍ للبيع.');
        $this->assertSame($black->id, $shown['pos_variants'][0]['id']);
        $this->assertSame('أسود / كبير', $shown['pos_variants'][0]['descriptor']);
        $this->assertSame('200.00', $shown['pos_variants'][0]['price']);
    }

    // ───────────────────────── ٢) حلّ الباركود الخادمي ─────────────────────────

    /** @test */
    public function barcode_resolution_returns_the_correct_product_variant_and_unit(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black] = $this->variantManagedProduct();
        ProductBarcode::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'product_variant_id' => $black->id,
            'code' => 'BLACK-LARGE-BC', 'unit_name' => $product->unit,
        ]);

        $resolved = $this->withToken($auth['token'])->postJson('/api/pos/barcode', ['code' => 'BLACK-LARGE-BC'])
            ->assertOk()['data'];

        $this->assertSame($product->id, $resolved['product_id']);
        $this->assertSame($black->id, $resolved['product_variant_id']);
        $this->assertSame('أسود / كبير', $resolved['variant_descriptor']);
        $this->assertSame($product->unit, $resolved['unit']);
        $this->assertSame(20000, $resolved['price']);
    }

    /** @test */
    public function a_simple_product_uom_barcode_still_resolves_correctly(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'صنفٌ بسيط', 'sku' => 'SIMPLE-BC', 'sale_price' => 10000, 'unit' => 'piece']);

        $resolved = $this->withToken($auth['token'])->postJson('/api/pos/barcode', ['code' => 'SIMPLE-BC'])
            ->assertOk()['data'];

        $this->assertSame($product->id, $resolved['product_id']);
        $this->assertNull($resolved['product_variant_id']);
        $this->assertSame('piece', $resolved['unit']);
        $this->assertSame(10000, $resolved['price']);
    }

    /** @test — الباركود لا يحدِّد السعر: نفس الباركود مع قائمة سعرٍ مختلفة للعميل يعيد سعراً مختلفاً. */
    public function barcode_does_not_determine_price_the_canonical_authority_does(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black] = $this->variantManagedProduct();
        ProductBarcode::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'product_variant_id' => $black->id,
            'code' => 'BLACK-BC', 'unit_name' => $product->unit,
        ]);

        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', ['name' => 'قائمة خاصة'])->assertCreated()['data'];
        \App\Models\PriceListItem::create([
            'tenant_id' => $auth['tenant_id'], 'price_list_id' => $priceList['id'],
            'product_id' => $product->id, 'product_variant_id' => $black->id,
            'unit_name' => $product->unit, 'price' => 17500,
        ]);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل بسعرٍ خاص', 'type' => 'customer', 'default_price_list_id' => $priceList['id'],
        ])->assertCreated()['data']['id'];

        $withoutList = $this->withToken($auth['token'])->postJson('/api/pos/barcode', ['code' => 'BLACK-BC'])->assertOk()['data'];
        $withList = $this->withToken($auth['token'])->postJson('/api/pos/barcode', ['code' => 'BLACK-BC', 'partner_id' => $partnerId])->assertOk()['data'];

        $this->assertSame(20000, $withoutList['price']);
        $this->assertSame(17500, $withList['price'], 'نفس الباركود، سعرٌ مختلفٌ حسب سلطة التسعير — لا سعر مخزَّن على الباركود نفسه.');
    }

    /** @test */
    public function a_barcode_without_a_resolved_variant_is_rejected_for_a_variant_managed_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product] = $this->variantManagedProduct();
        // باركودٌ بديلٌ بلا متغيّرٍ محدَّد على منتجٍ متعدد الخيارات — لا مسار بيعٍ غامض.
        ProductBarcode::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'product_variant_id' => null,
            'code' => 'AMBIGUOUS-BC', 'unit_name' => $product->unit,
        ]);

        $this->withToken($auth['token'])->postJson('/api/pos/barcode', ['code' => 'AMBIGUOUS-BC'])->assertStatus(422);
    }

    /** @test */
    public function a_cross_tenant_barcode_is_rejected_as_not_found(): void
    {
        $authA = $this->registerTenant('pos-var-a', 'owner@pos-var-a.test');
        app(TenantContext::class)->set($authA['tenant_id']);
        [$productA] = $this->variantManagedProduct('SHIRT-A');
        ProductBarcode::create([
            'tenant_id' => $authA['tenant_id'], 'product_id' => $productA->id,
            'code' => 'SHARED-CODE', 'unit_name' => $productA->unit,
        ]);

        $authB = $this->registerTenant('pos-var-b', 'owner@pos-var-b.test');
        $this->withToken($authB['token'])->postJson('/api/pos/barcode', ['code' => 'SHARED-CODE'])->assertStatus(422);
    }

    // ───────────────────────── ٣) حواجز الإتمام ─────────────────────────

    /** @test */
    public function checkout_denies_a_variant_managed_product_without_a_variant(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        [$product] = $this->variantManagedProduct();
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 23000)], [
            ['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertStatus(422);
    }

    /** @test */
    public function checkout_denies_a_simple_product_with_an_explicit_variant(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $product = Product::create(['name' => 'صنفٌ بسيط', 'sku' => 'SIMPLE-DENY', 'sale_price' => 10000]);
        [, $foreignVariant] = $this->variantManagedProduct('SHIRT-DENY');
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            ['product_id' => $product->id, 'product_variant_id' => $foreignVariant->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15],
        ])->assertStatus(422);
    }

    /** @test */
    public function checkout_denies_a_variant_belonging_to_a_different_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        [$productA] = $this->variantManagedProduct('SHIRT-X');
        [, $variantOfB] = $this->variantManagedProduct('SHIRT-Y');
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 23000)], [
            ['product_id' => $productA->id, 'product_variant_id' => $variantOfB->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertStatus(422);
    }

    /** @test */
    public function checkout_denies_a_cross_tenant_variant(): void
    {
        $authA = $this->registerTenant('pos-var-ct-a', 'owner@pos-var-ct-a.test');
        app(TenantContext::class)->set($authA['tenant_id']);
        [$productA] = $this->variantManagedProduct('SHIRT-CT-A');

        $authB = $this->registerTenant('pos-var-ct-b', 'owner@pos-var-ct-b.test');
        app(TenantContext::class)->set($authB['tenant_id']);
        [, $variantOfB] = $this->variantManagedProduct('SHIRT-CT-B');

        app(TenantContext::class)->set($authA['tenant_id']);
        $sessionId = $this->openSession($authA);
        $cash = $this->methodBySettlement($this->methods($authA), 'cash');
        $partnerId = $this->withToken($authA['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->checkout($authA['token'], $partnerId, $sessionId, [$this->tender($cash, 23000)], [
            ['product_id' => $productA->id, 'product_variant_id' => $variantOfB->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertStatus(422);
    }

    /** @test */
    public function checkout_denies_an_inactive_variant(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        [$product, $black] = $this->variantManagedProduct();
        $black->update(['is_active' => false]);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 23000)], [
            ['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertStatus(422);
    }

    /** @test — سعرٌ مطابقٌ لسعر الأب لا سعر المتغيّر يُرفض؛ لا fallback على منتجٍ شقيق. */
    public function checkout_rejects_a_price_that_does_not_match_the_variants_own_canonical_price(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        [$product, $black, $white] = $this->variantManagedProduct();
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        // سعر الأخ الشقيق (٢٢٠) بدل سعر الأسود الصحيح (٢٠٠).
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 25300)], [
            ['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 1, 'unit_price' => 22000, 'tax_rate' => 15],
        ])->assertStatus(422);
    }

    // ───────────────────────── ٤) المخزون والوثيقة ─────────────────────────

    /** @test */
    public function checkout_targets_the_variants_own_inventory_state_and_keeps_siblings_untouched(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black, $white] = $this->variantManagedProduct();
        $sessionId = $this->openSession($auth);

        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $this->lastWarehouseId], variant: $black);
        app(InventoryService::class)->receiveStock($product, 5, 9000, ['warehouse_id' => $this->lastWarehouseId], variant: $white);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $response = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 46000)], [
            ['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertCreated();

        $invoice = Invoice::findOrFail($response['data']['id']);
        $line = $invoice->lines()->first();
        $this->assertSame($product->id, $line->product_id);
        $this->assertSame($black->id, $line->product_variant_id);
        $this->assertSame('أسود / كبير', $line->variant_descriptor_snapshot);

        $blackState = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black->id)->firstOrFail();
        $whiteState = InventoryState::where('product_id', $product->id)->where('product_variant_id', $white->id)->firstOrFail();
        $this->assertSame(8, $blackState->quantity_on_hand);
        $this->assertSame(5, $whiteState->quantity_on_hand, 'الأخ الشقيق لا يتأثر.');

        $movement = StockMovement::where('source_type', Invoice::class)->where('source_id', $invoice->id)->firstOrFail();
        $this->assertSame($black->id, $movement->product_variant_id);
    }

    /** @test */
    public function a_simple_product_pos_sale_still_works_unchanged(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'صنفٌ بسيط', 'sku' => 'SIMPLE-SALE', 'sale_price' => 10000, 'track_inventory' => true]);
        $sessionId = $this->openSession($auth);

        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $this->lastWarehouseId]);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $response = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            ['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15],
        ])->assertCreated();

        $line = Invoice::findOrFail($response['data']['id'])->lines()->first();
        $this->assertSame($product->id, $line->product_id);
        $this->assertNull($line->product_variant_id);

        $state = InventoryState::where('product_id', $product->id)->whereNull('product_variant_id')->firstOrFail();
        $this->assertSame(9, $state->quantity_on_hand);
    }

    // ───────────────────────── ٥) Idempotency ─────────────────────────

    /** @test */
    public function the_same_idempotency_key_does_not_double_deduct_variant_inventory(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black] = $this->variantManagedProduct();
        $sessionId = $this->openSession($auth);

        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $this->lastWarehouseId], variant: $black);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $key = (string) Str::uuid();
        $items = [['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15]];

        $first = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 46000)], $items, $key)->assertCreated();
        $second = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 46000)], $items, $key)->assertOk();

        $this->assertSame($first['data']['id'], $second['data']['id'], 'إعادة الإرسال بنفس المفتاح تعيد نفس الفاتورة، لا فاتورة ثانية.');
        $this->assertSame(1, Invoice::where('pos_session_id', $sessionId)->count());

        $state = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black->id)->firstOrFail();
        $this->assertSame(8, $state->quantity_on_hand, 'الخصم مرّة واحدة فقط رغم إعادة الإرسال.');
    }

    /** @test — نفس المفتاح لكن متغيّراً مختلفاً محتوىً مختلفٌ يُرفض، لا يُعاد تشغيلٌ صامت. */
    public function the_same_idempotency_key_with_a_different_variant_is_rejected_as_a_conflict(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black, $white] = $this->variantManagedProduct();
        $sessionId = $this->openSession($auth);

        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $this->lastWarehouseId], variant: $black);
        app(InventoryService::class)->receiveStock($product, 10, 9000, ['warehouse_id' => $this->lastWarehouseId], variant: $white);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];
        $key = (string) Str::uuid();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 23000)], [
            ['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ], $key)->assertCreated();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 25300)], [
            ['product_id' => $product->id, 'product_variant_id' => $white->id, 'quantity' => 1, 'unit_price' => 22000, 'tax_rate' => 15],
        ], $key)->assertStatus(409);
    }

    // ───────────────────────── ٦) تعليق/استئناف البيع ─────────────────────────

    /** @test */
    public function a_held_sale_preserves_variant_identity_through_resume(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black] = $this->variantManagedProduct();
        $sessionId = $this->openSession($auth);

        $held = $this->withToken($auth['token'])->postJson('/api/pos/held-sales', [
            'pos_session_id' => $sessionId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black->id,
                'quantity' => 1, 'unit' => $product->unit, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()['data'];

        $this->assertSame($black->id, $held['items'][0]['product_variant_id']);

        $list = $this->withToken($auth['token'])->getJson("/api/pos/held-sales?pos_session_id={$sessionId}")->assertOk()['data'];
        $this->assertSame($black->id, collect($list)->firstWhere('id', $held['id'])['items'][0]['product_variant_id']);
    }

    /** @test — متغيّرٌ أصبح معطَّلاً بعد حفظ السلة وقبل الإتمام: الإتمام يفشل مغلَقاً، لا يُعاد التفسير لشقيقٍ آخر. */
    public function checkout_fails_closed_when_the_variant_is_deactivated_after_the_cart_was_saved(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black] = $this->variantManagedProduct();
        $sessionId = $this->openSession($auth);
        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $this->lastWarehouseId], variant: $black);

        $this->withToken($auth['token'])->postJson('/api/pos/held-sales', [
            'pos_session_id' => $sessionId,
            'items' => [[
                'product_id' => $product->id, 'product_variant_id' => $black->id,
                'quantity' => 1, 'unit' => $product->unit, 'unit_price' => 20000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $black->update(['is_active' => false]);

        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 23000)], [
            ['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertStatus(422);

        $state = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black->id)->firstOrFail();
        $this->assertSame(10, $state->quantity_on_hand, 'لا خصمٌ مخزنيٌّ من محاولةٍ فاشلة.');
    }

    // ───────────────────────── ٧) مرتجع POS ─────────────────────────

    /** @test */
    public function pos_return_carries_the_variant_identity_from_the_source_line(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        [$product, $black] = $this->variantManagedProduct();
        $sessionId = $this->openSession($auth);
        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $this->lastWarehouseId], variant: $black);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])->assertCreated()['data']['id'];

        $invoiceId = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 46000)], [
            ['product_id' => $product->id, 'product_variant_id' => $black->id, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15],
        ])->assertCreated()['data']['id'];

        $sourceLineId = Invoice::findOrFail($invoiceId)->lines()->first()->id;

        $returnable = $this->withToken($auth['token'])->getJson("/api/pos/returnable-invoices/{$invoiceId}?pos_session_id={$sessionId}")
            ->assertOk()['data'];
        $this->assertSame($black->id, $returnable['lines'][0]['product_variant_id']);
        $this->assertSame('أسود / كبير', $returnable['lines'][0]['variant_descriptor']);

        $return = $this->withToken($auth['token'])->postJson('/api/pos/returns', [
            'idempotency_key' => (string) Str::uuid(),
            'pos_session_id' => $sessionId,
            'original_invoice_id' => $invoiceId,
            'payment_type' => 'cash',
            'items' => [['source_line_id' => $sourceLineId, 'quantity' => 1]],
        ])->assertCreated()['data'];

        $returnLine = \App\Models\ReturnLine::where('return_id', $return['id'])->firstOrFail();
        $this->assertSame($black->id, $returnLine->product_variant_id);

        $state = InventoryState::where('product_id', $product->id)->where('product_variant_id', $black->id)->firstOrFail();
        $this->assertSame(9, $state->quantity_on_hand, '10 استلام − 2 بيع + 1 مرتجع = 9.');
    }
}

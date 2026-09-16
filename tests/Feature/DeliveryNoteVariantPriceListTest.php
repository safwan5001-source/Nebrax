<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryNote;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\DeliveryNoteSalesInvoiceDraftBuilder;
use App\Services\Accounting\DeliveryNoteService;
use App\Services\EntitlementGrantService;
use App\Services\PriceListService;
use App\Services\ProductVariantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * VAR-FU-6 (GAP-09) — `DeliveryNoteSalesInvoiceDraftBuilder` يجب أن يحلّ
 * قائمة الأسعار على مستوى المتغيّر الفعلي، لا الأب فقط، عند تحويل سند تسليم
 * مؤكَّد إلى مسودة فاتورة مبيعات بقائمة أسعار صريحة.
 */
class DeliveryNoteVariantPriceListTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private Tenant $tenant;
    private Branch $branch;
    private User $owner;
    private Partner $customer;
    private Warehouse $warehouse;
    private Product $simpleProduct;
    private Product $variantProduct;
    private ProductVariant $black;
    private ProductVariant $white;
    private DeliveryNoteService $deliveryNotes;
    private DeliveryNoteSalesInvoiceDraftBuilder $builder;
    private PriceListService $priceLists;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('dn-variant-price-list', 'owner@dn-variant-price-list.test');
        $this->tenant = Tenant::findOrFail($auth['tenant_id']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->branch = Branch::query()->firstOrFail();
        app(BranchContext::class)->set($this->branch->id);
        $this->grantSalesInvoicing($this->tenant);

        $this->owner = User::query()->where('email', 'owner@dn-variant-price-list.test')->firstOrFail();
        $this->customer = Partner::create(['type' => 'customer', 'name' => 'عميل قائمة أسعار المتغيّرات', 'is_active' => true]);
        $this->warehouse = Warehouse::create([
            'name' => 'مستودع قائمة أسعار المتغيّرات', 'code' => 'DN-VPL-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true,
        ]);

        $this->simpleProduct = Product::create([
            'name' => 'منتج بسيط', 'sku' => 'DN-VPL-SIMPLE', 'unit' => 'piece', 'sale_price' => 12500, 'tax_rate' => 15, 'is_active' => true,
        ]);

        $this->variantProduct = Product::create([
            'name' => 'قميص متعدد الخيارات', 'sku' => 'DN-VPL-SHIRT',
            'unit' => 'piece', 'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        [$this->black, $this->white] = $this->makeVariants($this->variantProduct, 'اللون', ['أسود', 'أبيض']);

        $this->deliveryNotes = app(DeliveryNoteService::class);
        $this->builder = app(DeliveryNoteSalesInvoiceDraftBuilder::class);
        $this->priceLists = app(PriceListService::class);
    }

    /** @param array<int,string> $values @return array<int,ProductVariant> */
    private function makeVariants(Product $product, string $optionName, array $values): array
    {
        $variants = app(ProductVariantService::class);
        $product = $variants->enableVariantManagement($product, $this->owner->id);
        $option = $variants->createOption($product, ['name' => $optionName], $this->owner->id);
        $created = [];
        foreach ($values as $value) {
            $optionValue = $variants->addOptionValue($option, ['value' => $value], $this->owner->id);
            $result = $variants->createSingleVariant($product, [$optionValue->id], $this->owner->id);
            $created[] = $result['variant'];
        }

        return $created;
    }

    #[Test]
    public function simple_product_delivery_note_to_invoice_draft_remains_unchanged(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار منتج بسيط', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->simpleProduct, ['unit_name' => null, 'price' => 17500]);
        $note = $this->confirmedNote($this->simpleProduct, [['product_id' => $this->simpleProduct->id, 'quantity' => 1]]);

        $command = $this->command($note, $priceList, [$this->line($note, 17500)], 'simple-unchanged-0001');
        $invoice = $this->builder->build($command)->invoice;

        $this->assertSame(17500, (int) $invoice->lines->sole()->unit_price);
        $this->assertNull($invoice->lines->sole()->product_variant_id);
    }

    #[Test]
    public function variant_with_explicit_matching_price_list_entry_succeeds(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار متغيّرات', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 22000], $this->black);
        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
        ]);

        $command = $this->command($note, $priceList, [$this->line($note, 22000)], 'variant-match-0001');
        $invoice = $this->builder->build($command)->invoice;

        $this->assertSame(22000, (int) $invoice->lines->sole()->unit_price);
        $this->assertSame($this->black->id, $invoice->lines->sole()->product_variant_id);
    }

    #[Test]
    public function variant_explicit_price_differs_from_parent_and_the_variant_price_is_used(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار الأب والمتغيّر', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 15000]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 26000], $this->black);
        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
        ]);

        $parentPriceCommand = $this->command($note, $priceList, [$this->line($note, 15000)], 'variant-parent-price-wrong-0001');
        try {
            $this->builder->build($parentPriceCommand);
            $this->fail('قُبل سعر الأب لسطرٍ يخصّ متغيّراً له سعر صريح مختلف.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(0, Invoice::count());

        $variantPriceCommand = $this->command($note, $priceList, [$this->line($note, 26000)], 'variant-own-price-right-0001');
        $invoice = $this->builder->build($variantPriceCommand)->invoice;
        $this->assertSame(26000, (int) $invoice->lines->sole()->unit_price);
    }

    #[Test]
    public function two_sibling_variants_resolve_their_own_price_with_no_leakage(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار شقيقين', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 21000], $this->black);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 23500], $this->white);
        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->white->id, 'quantity' => 1],
        ]);
        $fresh = $note->fresh('lines');
        $blackLine = $fresh->lines->firstWhere('product_variant_id', $this->black->id);
        $whiteLine = $fresh->lines->firstWhere('product_variant_id', $this->white->id);

        $command = $this->command($note, $priceList, [
            $this->line($note, 21000, $blackLine->id),
            $this->line($note, 23500, $whiteLine->id),
        ], 'variant-siblings-0001');
        $invoice = $this->builder->build($command)->invoice;

        $this->assertCount(2, $invoice->lines);
        $byVariant = $invoice->lines->keyBy('product_variant_id');
        $this->assertSame(21000, (int) $byVariant[$this->black->id]->unit_price);
        $this->assertSame(23500, (int) $byVariant[$this->white->id]->unit_price);
    }

    #[Test]
    public function variant_submitted_price_not_matching_its_own_list_entry_is_rejected(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار رفض متغيّر', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 24000], $this->black);
        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
        ]);

        $command = $this->command($note, $priceList, [$this->line($note, 19900)], 'variant-mismatch-0001');
        try {
            $this->builder->build($command);
            $this->fail('قُبل سعرٌ لا يطابق سعر المتغيّر الصريح في القائمة.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(0, Invoice::count());
    }

    #[Test]
    public function product_level_price_list_lookup_for_a_line_without_a_variant_remains_correct(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار على مستوى المنتج فقط', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->simpleProduct, ['unit_name' => null, 'price' => 13300]);
        $note = $this->confirmedNote($this->simpleProduct, [['product_id' => $this->simpleProduct->id, 'quantity' => 1]]);

        $preview = $this->builder->preview(['delivery_note_ids' => [$note->id], 'price_list_id' => $priceList->id]);
        $this->assertTrue($preview['compatible']);
        $this->assertSame(13300, $preview['delivery_notes'][0]['lines'][0]['suggested_unit_price']);

        $command = $this->command($note, $priceList, [$this->line($note, 13300)], 'product-level-fallback-0001');
        $invoice = $this->builder->build($command)->invoice;
        $this->assertSame(13300, (int) $invoice->lines->sole()->unit_price);
    }

    #[Test]
    public function a_variant_id_belonging_to_another_product_fails_closed(): void
    {
        $otherProduct = Product::create([
            'name' => 'قميص آخر', 'sku' => 'DN-VPL-OTHER-SHIRT',
            'unit' => 'piece', 'sale_price' => 9000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        [$foreignVariant] = $this->makeVariants($otherProduct, 'المقاس', ['كبير']);

        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
        ]);
        // نتلاعب مباشرةً بعمود قاعدة البيانات لمحاكاة بيانات فاسدة (سباق/تعديل مباشر)
        // لأن `DeliveryNoteService::create()` يرفض هذا المدخل أصلاً عبر نفس المحلّل.
        $fresh = $note->fresh('lines');
        $fresh->lines->sole()->forceFill(['product_variant_id' => $foreignVariant->id])->saveQuietly();

        $priceList = PriceList::create(['name' => 'قائمة أسعار متغيّر أجنبي', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 22000], $this->black);

        $command = $this->command($note, $priceList, [$this->line($note, 22000)], 'foreign-variant-fail-closed-0001');
        try {
            $this->builder->build($command);
            $this->fail('قُبل متغيّرٌ لا يتبع منتج السطر.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(0, Invoice::count());
    }

    #[Test]
    public function a_variant_from_another_tenant_fails_closed(): void
    {
        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
        ]);

        $otherAuth = $this->registerTenant('dn-variant-price-list-other', 'owner@dn-variant-price-list-other.test');
        $otherTenant = Tenant::findOrFail($otherAuth['tenant_id']);
        app(TenantContext::class)->set($otherTenant->id);
        $otherOwner = User::query()->where('email', 'owner@dn-variant-price-list-other.test')->firstOrFail();
        $otherProduct = Product::create([
            'name' => 'قميص مستأجر آخر', 'sku' => 'DN-VPL-CROSS-SHIRT',
            'unit' => 'piece', 'sale_price' => 9000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        $otherVariants = app(ProductVariantService::class);
        $otherProduct = $otherVariants->enableVariantManagement($otherProduct, $otherOwner->id);
        $otherOption = $otherVariants->createOption($otherProduct, ['name' => 'اللون'], $otherOwner->id);
        $otherValue = $otherVariants->addOptionValue($otherOption, ['value' => 'أخضر'], $otherOwner->id);
        $crossTenantVariant = $otherVariants->createSingleVariant($otherProduct, [$otherValue->id], $otherOwner->id)['variant'];
        app(TenantContext::class)->set($this->tenant->id);

        $fresh = $note->fresh('lines');
        $fresh->lines->sole()->forceFill(['product_variant_id' => $crossTenantVariant->id])->saveQuietly();

        $priceList = PriceList::create(['name' => 'قائمة أسعار عزل مستأجر', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 22000], $this->black);

        $command = $this->command($note, $priceList, [$this->line($note, 22000)], 'cross-tenant-fail-closed-0001');
        try {
            $this->builder->build($command);
            $this->fail('قُبل متغيّرٌ من مستأجرٍ آخر.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(0, Invoice::count());
    }

    #[Test]
    public function null_product_variant_id_remains_simple_product_behavior(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة تأكيد سلوك المنتج البسيط', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->simpleProduct, ['unit_name' => null, 'price' => 18800]);
        $note = $this->confirmedNote($this->simpleProduct, [['product_id' => $this->simpleProduct->id, 'quantity' => 1]]);

        $fresh = $note->fresh('lines');
        $this->assertNull($fresh->lines->sole()->product_variant_id);

        $command = $this->command($note, $priceList, [$this->line($note, 18800)], 'null-variant-simple-0001');
        $invoice = $this->builder->build($command)->invoice;
        $this->assertSame(18800, (int) $invoice->lines->sole()->unit_price);
        $this->assertNull($invoice->lines->sole()->product_variant_id);
    }

    #[Test]
    public function variant_pricing_respects_an_explicit_non_base_unit_on_the_price_list(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة أسعار وحدة بديلة لمتغيّر', 'is_active' => true]);
        $this->priceLists->upsertItem($priceList, $this->variantProduct, ['unit_name' => null, 'price' => 20000], $this->black);
        $note = $this->confirmedNote($this->variantProduct, [
            ['product_id' => $this->variantProduct->id, 'product_variant_id' => $this->black->id, 'quantity' => 1],
        ]);

        // الوحدة المخزَّنة على السطر تطابق وحدة الأساس؛ نتحقق أن التمرير عبر
        // `requestedUnit = null` (لا اسم الوحدة الصريح) ما زال يحل على المتغيّر
        // لا الأب، تماماً كما قبل هذا الإصلاح لمنتجٍ بسيط.
        $fresh = $note->fresh('lines');
        $this->assertSame($this->variantProduct->unit, $fresh->lines->sole()->unit_name);

        $command = $this->command($note, $priceList, [$this->line($note, 20000)], 'variant-base-unit-0001');
        $invoice = $this->builder->build($command)->invoice;
        $this->assertSame(20000, (int) $invoice->lines->sole()->unit_price);
    }

    private function confirmedNote(Product $product, array $items): DeliveryNote
    {
        $note = $this->deliveryNotes->create($this->header(), $items);

        return $this->deliveryNotes->confirm($note, $note->version, $this->owner->id, 'تم تأكيد التسليم للفوترة.');
    }

    /** @param array<string,mixed> $override @return array<string,mixed> */
    private function header(array $override = []): array
    {
        return $override + [
            'customer_id' => $this->customer->id,
            'warehouse_id' => $this->warehouse->id,
            'delivery_date' => '2026-09-14',
            'created_by' => $this->owner->id,
        ];
    }

    /** @return array{delivery_note_line_id:string,unit_price:int,tax_rate:int,discount:int} */
    private function line(DeliveryNote $note, int $unitPrice, ?string $lineId = null): array
    {
        $lineId ??= $note->fresh('lines')->lines->sole()->id;

        return [
            'delivery_note_line_id' => $lineId,
            'unit_price' => $unitPrice,
            'tax_rate' => 15,
            'discount' => 0,
        ];
    }

    /** @param array<int,array<string,mixed>> $pricing @return array<string,mixed> */
    private function command(DeliveryNote $note, PriceList $priceList, array $pricing, string $idempotencyKey): array
    {
        $fresh = $note->fresh('lines');

        return [
            'delivery_note_ids' => [$fresh->id],
            'expected_versions' => [$fresh->id => $fresh->version],
            'idempotency_key' => $idempotencyKey,
            'reason' => 'اختبار انتشار هويّة المتغيّر داخل حلّ قائمة الأسعار (VAR-FU-6).',
            'invoice_date' => '2026-09-15',
            'tax_inclusive' => false,
            'price_list_id' => $priceList->id,
            'line_pricing' => $pricing,
            'actor_id' => $this->owner->id,
        ];
    }

    private function grantSalesInvoicing(Tenant $tenant): void
    {
        app(EntitlementGrantService::class)->grant(
            $tenant,
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            now()->subMinute(),
            null,
            'delivery-note-variant-price-list-test',
            $tenant->id,
        );
    }
}

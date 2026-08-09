<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Support\BranchSettings;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  P3-ج-٢ — المنتجات بعزل مشروط · حركات المخزون موسومة بفرع المخزن
 * ═══════════════════════════════════════════════════════════════
 *  كل مسار يُختبر **مرّتين**:
 *   • المفتاح مفعّل (الافتراضي) ⇒ سلوك اليوم حرفياً — لا شيء تغيّر.
 *   • المفتاح مطفأ            ⇒ العزل يعمل في التصفّح، **وقيد تكلفة البضاعة
 *     المباعة ما زال يُولَّد** لمرجعٍ عابرٍ للفروع. هذا هو بيت القصيد كله.
 *
 *  تشغيل: php artisan test --filter=BranchProductIsolationTest
 */
class BranchProductIsolationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const COGS = '5110';

    private function branch(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function mainBranch(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')['data'][0]['id'];
    }

    /** منتج متتبَّع مخزونياً برصيد افتتاحي، منشأ في فرع محدّد. */
    private function product(string $token, string $branchId, string $name, int $qty = 10): array
    {
        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->postJson('/api/products', [
                'name' => $name, 'type' => 'good',
                'sale_price' => 20000, 'purchase_price' => 10000,
                'track_inventory' => true, 'initial_quantity' => $qty,
            ])->assertCreated()['data'];
    }

    private function customer(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** فاتورة نقدية بسطر منتج واحد، مُنشأة في فرع محدّد (بلا ترحيل). */
    private function invoice(string $token, string $branchId, string $partnerId, string $productId): array
    {
        return $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->postJson('/api/invoices', [
                'partner_id' => $partnerId, 'payment_type' => 'cash',
                'items' => [['product_id' => $productId, 'quantity' => 2, 'unit_price' => 20000, 'tax_rate' => 15]],
            ])->assertCreated()['data'];
    }

    private function postInvoice(string $token, string $branchId, string $invoiceId): void
    {
        $this->withToken($token)->withHeaders(['X-Branch-Id' => $branchId])
            ->postJson("/api/invoices/{$invoiceId}/post")->assertOk();
    }

    /** قيد تكلفة البضاعة المباعة لفاتورة (أو null إن لم يُولَّد). */
    private function cogsEntry(string $invoiceId): ?JournalEntry
    {
        return JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $invoiceId)
            ->get()
            ->first(fn (JournalEntry $e) => $e->lines->contains(fn (JournalLine $l) => $l->account?->code === self::COGS));
    }

    // ═══════════ الحالة الافتراضية: مشترك ⇒ لا شيء تغيّر ═══════════

    /** @test */
    public function products_are_shared_across_branches_by_default(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->product($auth['token'], $khobar, 'منتج الخبر');

        // الفرع الرئيسي يراه — المفتاح مفعّل افتراضياً
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/products')->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function a_sale_of_another_branch_product_posts_cogs_normally_when_shared(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $product = $this->product($auth['token'], $khobar, 'منتج الخبر');
        $invoice = $this->invoice($auth['token'], $main, $this->customer($auth['token']), $product['id']);
        $this->postInvoice($auth['token'], $main, $invoice['id']);

        $this->assertNotNull($this->cogsEntry($invoice['id']), 'قيد التكلفة يجب أن يُولَّد.');
        $this->assertSame(8, Product::withoutGlobalScope(BranchScope::class)->find($product['id'])->quantity_on_hand);
    }

    // ═══════════ المفتاح مطفأ: العزل يعمل ═══════════

    /** @test */
    public function turning_the_key_off_isolates_product_browsing(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $khobarProduct = $this->product($auth['token'], $khobar, 'منتج الخبر');
        $this->product($auth['token'], $main, 'منتج الرئيسي');

        BranchSettings::merge(['share_products' => false]);

        $names = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/products')->assertOk()->json('data.*.name');
        $this->assertSame(['منتج الرئيسي'], $names);

        // ولا يُفتح بمعرّفه من فرع آخر (تصفّح)
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson("/api/products/{$khobarProduct['id']}")->assertNotFound();
    }

    /**
     * **الاختبار الأهم في الموجة كلها.** مستأجر أنشأ بياناته وهي مشتركة، ثم
     * أطفأ المفتاح. فاتورةٌ قائمة تشير إلى منتج فرع آخر يجب أن تُرحَّل بقيد
     * تكلفة كامل — لا أن يُتخطّى السطر صامتاً فينتفخ الربح.
     *
     * @test
     */
    public function cogs_still_posts_for_a_cross_branch_product_after_isolation_is_enabled(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $product = $this->product($auth['token'], $khobar, 'منتج الخبر');
        $invoice = $this->invoice($auth['token'], $main, $this->customer($auth['token']), $product['id']);

        BranchSettings::merge(['share_products' => false]); // العزل يُفعَّل بعد إنشاء المستند

        $this->postInvoice($auth['token'], $main, $invoice['id']);

        $cogs = $this->cogsEntry($invoice['id']);
        $this->assertNotNull($cogs, 'قيد التكلفة اختفى — المرجع صُفّي بالفرع.');

        // ٢ × ١٠٠ ريال متوسط تكلفة = ٢٠٠ ريال، والقيد متوازن
        $line = $cogs->lines->first(fn (JournalLine $l) => $l->account?->code === self::COGS);
        $this->assertSame(20000, (int) $line->debit);
        $this->assertSame($cogs->lines->sum('debit'), $cogs->lines->sum('credit'));

        // والمخزون خُفِّض فعلاً
        $this->assertSame(8, Product::withoutGlobalScope(BranchScope::class)->find($product['id'])->quantity_on_hand);
    }

    /** @test */
    public function legacy_products_without_a_branch_stay_visible_when_isolated(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main = $this->mainBranch($auth['token']);
        $this->branch($auth['token'], 'فرع الخبر');

        Product::withoutGlobalScope(BranchScope::class)->create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => null,
            'name' => 'منتج قديم', 'type' => 'good',
        ]);

        BranchSettings::merge(['share_products' => false]);

        $names = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/products')->assertOk()->json('data.*.name');
        $this->assertSame(['منتج قديم'], $names);
    }

    /** إعفاء المنتجات لا يتسرّب لنموذج آخر معزول بلا شرط. */
    /** @test */
    public function the_product_exemption_does_not_leak_to_other_models(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $khobar])
            ->postJson('/api/contacts', ['name' => 'جهة اتصال الخبر'])->assertCreated();

        // المنتجات مشتركة، لكن جهات الاتصال معزولة بلا شرط
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $main])
            ->getJson('/api/contacts')->assertOk()->assertJsonCount(0, 'data');
    }

    // ═══════════ وسم حركة المخزون بفرع المخزن ═══════════

    /** @test */
    public function stock_movements_are_stamped_with_the_warehouse_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        // مخزن يتبع فرع الخبر
        $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن الخبر', 'branch_id' => $khobar,
        ])->assertCreated();

        $product = $this->product($auth['token'], $main, 'منتج', 5);
        $invoice = $this->invoice($auth['token'], $khobar, $this->customer($auth['token']), $product['id']);
        $this->postInvoice($auth['token'], $khobar, $invoice['id']);

        $out = StockMovement::where('product_id', $product['id'])->where('type', 'out')->firstOrFail();
        $warehouse = Warehouse::findOrFail($out->warehouse_id);

        $this->assertSame($khobar, $warehouse->branch_id);
        $this->assertSame($khobar, $out->branch_id, 'الحركة تتبع فرع المخزن.');
    }

    /**
     * الفرع النشط لا يقرّر فرع الحركة — المخزن يقرّره. الفرع النشط هنا **الرئيسي**
     * والمخزن يتبع الخبر، فلو غلب الفرع النشط لظهر الوسم خاطئاً.
     *
     * @test
     */
    public function the_active_branch_does_not_override_the_warehouse_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $main   = $this->mainBranch($auth['token']);
        $khobar = $this->branch($auth['token'], 'فرع الخبر');

        $warehouseKhobar = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن الخبر', 'branch_id' => $khobar,
        ])->assertCreated()['data']['id'];

        $created = $this->product($auth['token'], $main, 'منتج', 0);

        app(BranchContext::class)->set($main); // الفرع النشط = الرئيسي
        $product = Product::withoutGlobalScope(BranchScope::class)->findOrFail($created['id']);

        $movement = app(InventoryService::class)->applyReceipt($product, 4, 10000, [
            'warehouse_id' => $warehouseKhobar,
        ]);

        $this->assertSame($warehouseKhobar, $movement->warehouse_id);
        $this->assertSame($khobar, $movement->branch_id, 'الفرع النشط كان الرئيسي — والحركة تتبع مخزن الخبر.');
    }

    /** مخزن بلا فرع (مركزي) يترك الوسم للفرع النشط — تراجع سليم لا فقدان بيانات. */
    /** @test */
    public function a_central_warehouse_falls_back_to_the_active_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $khobar = $this->branch($auth['token'], 'فرع الخبر');
        $central = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => 'مخزن مركزي',
        ])->assertCreated()['data']['id'];

        $created = $this->product($auth['token'], $khobar, 'منتج', 0);

        app(BranchContext::class)->set($khobar);
        $product = Product::withoutGlobalScope(BranchScope::class)->findOrFail($created['id']);

        $movement = app(InventoryService::class)->applyReceipt($product, 3, 10000, [
            'warehouse_id' => $central,
        ]);

        $this->assertNull(Warehouse::findOrFail($central)->branch_id);
        $this->assertSame($khobar, $movement->branch_id);
    }
}

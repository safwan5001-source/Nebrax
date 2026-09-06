<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-PRICE-1 — الحد الأدنى بعد كل الخصومات المطبَّقة اقتصادياً
 * ═══════════════════════════════════════════════════════════════
 *  الثغرة المؤكدة: حارس السعر الأدنى كان يحكم على صافي السطر **قبل** خصم
 *  الفاتورة (الرأس)، فيمرّ سطرٌ فوق الحد ثم يهبط خصمُ الرأس بسعره الفعلي دون
 *  المرور بمسار الاستثناء المخوَّل. هذا الملف يثبت المصفوفة الكاملة من العقد:
 *  `docs/plans/products-inventory/phase-1-hardening/PR-PRICE-1.md`.
 *
 *  `MinimumSalePriceGuardTest` يبقى كما هو — يثبت السلوك الأساسي (تبديل
 *  السياسة، تخويل المالك، رفض المحاسب، تكافؤ POS) بلا خصم رأسٍ في الصورة.
 *  هنا التركيز حصراً على تفاعل خصم الرأس مع الحد الأدنى.
 *
 *  تشغيل: php artisan test --filter=MinimumSalePriceHeaderDiscountTest
 */
class MinimumSalePriceHeaderDiscountTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected InvoiceService $invoices;
    protected User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-price1',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->owner = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'المالك', 'email' => 'owner@price1.test',
            'password' => 'password123', 'role' => 'owner',
        ]);
        $this->invoices = app(InvoiceService::class);
    }

    private function product(int $minSalePrice, int $salePrice = 0): Product
    {
        return Product::create([
            'name' => 'منتج محروس', 'type' => 'good',
            'sale_price' => $salePrice ?: $minSalePrice,
            'min_sale_price' => $minSalePrice,
        ]);
    }

    /** دور مخصَّص بلا `sales.minimum_price_override` — يشبه accountant لكن بمعزل عن المصفوفة الثابتة. */
    private function unauthorizedUser(): User
    {
        $role = Role::create([
            'tenant_id' => $this->tenant->id, 'slug' => 'no-override-'.uniqid(),
            'name' => 'بلا تخويل', 'permissions' => ['invoices.manage'], 'is_system' => false,
        ]);

        return User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مستخدم غير مخوَّل',
            'email' => 'unauthorized-'.uniqid().'@price1.test', 'password' => 'password123', 'role' => $role->slug,
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  raw line above floor + header discount pushes below → reject
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_header_discount_that_pushes_an_otherwise_valid_line_below_the_floor_is_rejected(): void
    {
        // سطرٌ وحيد صافيه ١٥٠ فوق الحد ١٠٠ — لكن خصم الرأس ٦٠ يهبط بالفعلي إلى ٩٠.
        $product = $this->product(minSalePrice: 10000);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من الحد الأدنى');

        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 6000],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 15000, 'tax_rate' => 0]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  line discount alone below floor → reject (بلا خصم رأس إطلاقاً)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_line_discount_alone_below_the_floor_is_rejected(): void
    {
        $product = $this->product(minSalePrice: 10000);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من الحد الأدنى');

        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 15000, 'discount' => 6000, 'tax_rate' => 0]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  combined line + header discount below floor → reject
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function combined_line_and_header_discounts_below_the_floor_are_rejected(): void
    {
        // ٢٠٠ - خصم سطر ٣٠ = ١٧٠ صافي سطر. خصم رأس ٣٠ إضافي (سطر وحيد فيأخذه
        // كاملاً) ⇒ فعليّ ١٤٠ — تحت الحد ١٥٠.
        $product = $this->product(minSalePrice: 15000);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من الحد الأدنى');

        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 3000],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000, 'discount' => 3000, 'tax_rate' => 0]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  effective price exactly at the floor → accept
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_effective_price_exactly_at_the_floor_after_header_discount_is_accepted(): void
    {
        // ١٥٠ - خصم رأس ٥٠ (سطر وحيد) = ١٠٠ = الحد تماماً.
        $product = $this->product(minSalePrice: 10000);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 5000],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 15000, 'tax_rate' => 0]]
        );

        $line = $invoice->lines->first();
        $this->assertSame(10000, $line->min_sale_price_snapshot);
        $this->assertNull($line->min_sale_price_override_reason, 'المساواة بالحد تُقبل بلا حاجة لاستثناء.');
    }

    // ═══════════════════════════════════════════════════════════
    //  above floor → accept
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_effective_price_above_the_floor_after_header_discount_is_accepted(): void
    {
        $product = $this->product(minSalePrice: 10000);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 2000],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 15000, 'tax_rate' => 0]]
        );

        $line = $invoice->lines->first();
        $this->assertSame(10000, $line->min_sale_price_snapshot);
        $this->assertNull($line->min_sale_price_override_reason);
    }

    // ═══════════════════════════════════════════════════════════
    //  authorized override → accept through the existing controlled path
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_authorized_override_accepts_a_line_pushed_below_the_floor_by_header_discount(): void
    {
        $product = $this->product(minSalePrice: 15000);

        $invoice = $this->invoices->create(
            [
                'partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 6000,
                'minimum_price_override_actor_id' => $this->owner->id,
            ],
            [[
                'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 0,
                'minimum_price_override_reason' => 'تصريف مخزون نهاية الموسم',
            ]]
        );

        $line = $invoice->lines->first();
        $this->assertSame(15000, $line->min_sale_price_snapshot);
        $this->assertSame('تصريف مخزون نهاية الموسم', $line->min_sale_price_override_reason);
        $this->assertSame($this->owner->id, $line->min_sale_price_overridden_by);
    }

    // ═══════════════════════════════════════════════════════════
    //  unauthorized override flag/input → reject
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_unauthorized_actor_cannot_override_even_with_a_reason_when_header_discount_causes_the_violation(): void
    {
        $product = $this->product(minSalePrice: 15000);
        $unauthorized = $this->unauthorizedUser();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('يتطلب اعتماد مالك أو مدير مخوّل');

        $this->invoices->create(
            [
                'partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 6000,
                'minimum_price_override_actor_id' => $unauthorized->id,
            ],
            [[
                'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 0,
                'minimum_price_override_reason' => 'محاولة تجاوز بلا صلاحية',
            ]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  multi-line header allocation catches only the violating line(s)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function multi_line_header_discount_allocation_flags_only_the_violating_line(): void
    {
        // ثلاثة أصناف بحدود وأسعار مختلفة، خصم رأس واحد موزَّع تناسبياً:
        //   سطر ١: صافي ٢٠٠، حصة ٤٠  ⇒ فعليّ ١٦٠  ضد حدّ ١٠٠  → يمر
        //   سطر ٢: صافي ١٥٠، حصة ٣٠  ⇒ فعليّ ١٢٠  ضد حدّ ١٤٠  → ينتهك وحده
        //   سطر ٣: صافي ٣٠٠، حصة ٦٠  ⇒ فعليّ ٢٤٠  ضد حدّ ٥٠   → يمر
        // المجموع = ٦٥٠، الخصم = ١٣٠ (٢٠٪) يوزَّع بلا باقٍ (٤٠+٣٠+٦٠=١٣٠).
        $p1 = $this->product(minSalePrice: 10000);
        $p2 = $this->product(minSalePrice: 14000);
        $p3 = $this->product(minSalePrice: 5000);

        $invoice = $this->invoices->create(
            [
                'partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 13000,
                'minimum_price_override_actor_id' => $this->owner->id,
            ],
            [
                ['product_id' => $p1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 0],
                [
                    'product_id' => $p2->id, 'quantity' => 1, 'unit_price' => 15000, 'tax_rate' => 0,
                    'minimum_price_override_reason' => 'الوحيد الذي يحتاج استثناء',
                ],
                ['product_id' => $p3->id, 'quantity' => 1, 'unit_price' => 30000, 'tax_rate' => 0],
            ]
        );

        $lines = $invoice->lines()->orderBy('id')->get();
        $this->assertCount(3, $lines);

        $this->assertSame(10000, $lines[0]->min_sale_price_snapshot);
        $this->assertNull($lines[0]->min_sale_price_override_reason, 'السطر الأول لم ينتهك — لا يحتاج استثناء.');

        $this->assertSame(14000, $lines[1]->min_sale_price_snapshot);
        $this->assertSame('الوحيد الذي يحتاج استثناء', $lines[1]->min_sale_price_override_reason);
        $this->assertSame($this->owner->id, $lines[1]->min_sale_price_overridden_by);

        $this->assertSame(5000, $lines[2]->min_sale_price_snapshot);
        $this->assertNull($lines[2]->min_sale_price_override_reason, 'السطر الثالث لم ينتهك — لا يحتاج استثناء.');
    }

    /** @test */
    public function multi_line_header_discount_rejects_when_the_violating_line_lacks_its_own_override_reason(): void
    {
        // نفس أرقام الاختبار السابق تماماً، لكن بلا سبب استثناء على السطر
        // المنتهك — يجب أن يُرفض تحديداً، لا أن يمرّ لأن سطرين آخرين سليمان.
        $p1 = $this->product(minSalePrice: 10000);
        $p2 = $this->product(minSalePrice: 14000);
        $p3 = $this->product(minSalePrice: 5000);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من الحد الأدنى');

        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 13000],
            [
                ['product_id' => $p1->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 0],
                ['product_id' => $p2->id, 'quantity' => 1, 'unit_price' => 15000, 'tax_rate' => 0],
                ['product_id' => $p3->id, 'quantity' => 1, 'unit_price' => 30000, 'tax_rate' => 0],
            ]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  tax and rounding cases cannot create a hidden bypass
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function header_discount_allocation_is_based_on_pretax_net_regardless_of_line_tax_rates(): void
    {
        // صافي متساوٍ (٢٠٠٠٠) لسطرين، ضريبة مختلفة تماماً (١٥٪ و٠٪) — يجب أن
        // يتساوى نصيب كلٍّ من خصم الرأس رغم اختلاف الضريبة: الضريبة ليست خصماً.
        $taxable = $this->product(minSalePrice: 10000);
        $exempt = $this->product(minSalePrice: 10000);

        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 8000],
            [
                ['product_id' => $taxable->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 15],
                ['product_id' => $exempt->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 0],
            ]
        );

        $lines = $invoice->lines()->orderBy('id')->get();
        // فعليّ كل سطر = ٢٠٠٠٠ - ٤٠٠٠ = ١٦٠٠٠ — فوق الحد ١٠٠٠٠ لكليهما بالتساوي.
        $this->assertSame(10000, $lines[0]->min_sale_price_snapshot);
        $this->assertSame(10000, $lines[1]->min_sale_price_snapshot);
        $this->assertNull($lines[0]->min_sale_price_override_reason);
        $this->assertNull($lines[1]->min_sale_price_override_reason);
        // الضريبة على السطر الخاضع لا تُحسب في الفاتورة نفسها (لن تتأثر بخصم الرأس هنا) — تحقّق منفصل غير جوهري لهذا الاختبار.
        $this->assertGreaterThan(0, (int) $lines[0]->line_tax);
        $this->assertSame(0, (int) $lines[1]->line_tax);
    }

    /** @test */
    public function tax_inclusive_pricing_with_a_header_discount_still_evaluates_the_pretax_floor(): void
    {
        // سعر متضمِّن الضريبة ١١٥ لسطر وحيد ⇒ ضريبة مستخرَجة ١٥، صافٍ ١٠٠
        // (`lineNet`). خصم الرأس دائماً على الأساس الصافي — لا على المتضمِّن —
        // فخصم رأس ١١.٥٠ يترك فعليّاً ٨٨.٥٠، فوق الحد ٨٠ بوضوح.
        $product = $this->product(minSalePrice: 8000);

        $invoice = $this->invoices->create(
            [
                'partner_id' => $this->customer->id, 'payment_type' => 'cash',
                'tax_inclusive' => true, 'discount' => 1150,
            ],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15]]
        );

        $line = $invoice->lines->first();
        $this->assertSame(10000, $invoice->subtotal, 'الصافي المستخرَج من ١١٥٠٠ متضمِّنة عند ١٥٪ هو ١٠٠٠٠.');
        $this->assertSame(8000, $line->min_sale_price_snapshot);
        $this->assertNull($line->min_sale_price_override_reason, '٨٨٥٠ فعليّاً فوق الحد ٨٠٠٠ فلا حاجة لاستثناء.');
    }

    /** @test */
    public function tax_inclusive_pricing_with_a_header_discount_that_crosses_the_floor_is_rejected(): void
    {
        // نفس السطر أعلاه، لكن خصم رأس أكبر (٣٠٠٠) يترك فعليّاً ٧٠٠٠ — تحت
        // الحد ٨٠٠٠. يثبت أن وضع «متضمِّن» لا يفتح ثغرة في الحارس نفسه.
        $product = $this->product(minSalePrice: 8000);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من الحد الأدنى');

        $this->invoices->create(
            [
                'partner_id' => $this->customer->id, 'payment_type' => 'cash',
                'tax_inclusive' => true, 'discount' => 3000,
            ],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  free / 100% discount edge case
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_full_header_discount_that_zeroes_the_line_is_rejected_without_override(): void
    {
        $product = $this->product(minSalePrice: 10000);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من الحد الأدنى');

        $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 15000],
            [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 15000, 'tax_rate' => 0]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  override revoked between draft calculation and authoritative save
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_permission_revoked_before_the_authoritative_save_is_rejected_live_not_from_a_stale_check(): void
    {
        $product = $this->product(minSalePrice: 15000);
        $role = Role::create([
            'tenant_id' => $this->tenant->id, 'slug' => 'temp-override-'.uniqid(),
            'name' => 'تخويل مؤقت', 'permissions' => ['invoices.manage', 'sales.minimum_price_override'],
            'is_system' => false,
        ]);
        $actor = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مخوَّل مؤقتاً',
            'email' => 'temp-override-'.uniqid().'@price1.test', 'password' => 'password123', 'role' => $role->slug,
        ]);
        $this->assertTrue($actor->hasPermission('sales.minimum_price_override'), 'الصلاحية ممنوحة قبل السحب.');

        // يُسحب التخويل — تماماً كما لو أُعيد التحقق حياً بعد أن حسبت الواجهة
        // مسودتها بصلاحية كانت قائمة لحظة الحساب لا لحظة الحفظ.
        $role->update(['permissions' => ['invoices.manage']]);
        $this->assertFalse($actor->fresh()->hasPermission('sales.minimum_price_override'));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('يتطلب اعتماد مالك أو مدير مخوّل');

        $this->invoices->create(
            [
                'partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 6000,
                'minimum_price_override_actor_id' => $actor->id,
            ],
            [[
                'product_id' => $product->id, 'quantity' => 1, 'unit_price' => 20000, 'tax_rate' => 0,
                'minimum_price_override_reason' => 'محاولة بعد سحب الصلاحية',
            ]]
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  رجوع: خصم الرأس لا يزال يحسب الإجماليات كما هو تماماً
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function header_discount_totals_remain_unchanged_by_the_new_two_pass_computation(): void
    {
        // لا منتج (بلا حد أدنى) — تحقّق أن إعادة الهيكلة لم تُغيّر حساب
        // الإجماليات نفسه؛ يطابق نتيجة `InvoiceTest::an_invoice_discount_reduces_the_taxable_base_and_totals`.
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'discount' => 20000],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        $this->assertSame(100000, $invoice->subtotal);
        $this->assertSame(20000, $invoice->discount);
        $this->assertSame(12000, $invoice->tax_amount);
        $this->assertSame(92000, $invoice->total);
    }
}

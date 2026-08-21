<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  قوالب الوحدات — الشراء والبيع بوحدة غير وحدة المخزون
 * ═══════════════════════════════════════════════════════════════
 *  **العقد المُختبَر هنا:** الكمية تُحوَّل، والنقود لا تُحوَّل.
 *
 *  السطر يحفظ الكمية بالوحدة المُدخَلة وسعرها بها، فيبقى
 *  `line_subtotal = quantity × unit_price` صحيحاً بلا كسر؛ والمخزون وحده
 *  يضرب في المعامل. فلا يتغيّر أي مبلغ في أي قيد، وتصحّ الكمية والمتوسط.
 *
 *  تشغيل: php artisan test --filter=UnitTemplateTest
 */
class UnitTemplateTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $customerId;
    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->token = $this->registerTenant()['token'];
        $this->customerId = $this->partner('عميل', 'customer');
        $this->supplierId = $this->partner('مورد', 'supplier');
    }

    private function partner(string $name, string $type): string
    {
        return $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => $name, 'type' => $type])
            ->assertCreated()['data']['id'];
    }

    /** قالب «كيس» أساساً و«طبلية = ٥٠ كيساً». */
    private function template(array $units = [['name' => 'طبلية', 'factor' => 50]]): array
    {
        return $this->withToken($this->token)->postJson('/api/unit-templates', [
            'name' => 'وحدات الإسمنت', 'base_unit' => 'كيس', 'units' => $units,
        ])->assertCreated()['data'];
    }

    private function product(?string $templateId = null, int $qty = 0, int $cost = 1000): array
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => 'إسمنت', 'sku' => 'CEM-' . uniqid(), 'type' => 'good', 'unit' => 'كيس',
            'purchase_price' => $cost, 'sale_price' => $cost * 2,
            'track_inventory' => true, 'initial_quantity' => $qty,
            'unit_template_id' => $templateId,
        ])->assertCreated()['data'];
    }

    private function buy(string $productId, int $qty, int $unitPrice, ?string $unit = null)
    {
        $purchase = $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [array_filter([
                'product_id' => $productId, 'quantity' => $qty,
                'unit_price' => $unitPrice, 'tax_rate' => 0, 'unit' => $unit,
            ], fn ($v) => $v !== null)],
        ])->assertCreated()['data'];

        return $this->withToken($this->token)->postJson("/api/purchases/{$purchase['id']}/post");
    }

    private function sell(string $productId, int $qty, int $unitPrice, ?string $unit = null)
    {
        $invoice = $this->withToken($this->token)->postJson('/api/invoices', [
            'partner_id' => $this->customerId, 'payment_type' => 'cash',
            'items' => [array_filter([
                'product_id' => $productId, 'quantity' => $qty,
                'unit_price' => $unitPrice, 'tax_rate' => 0, 'unit' => $unit,
            ], fn ($v) => $v !== null)],
        ])->assertCreated()['data'];

        return $this->withToken($this->token)->postJson("/api/invoices/{$invoice['id']}/post");
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    /** القالب يُنشأ بوحدة أساس ووحدات بديلة، والأساس يظهر أولاً بمعامل ١. */
    /** @test */
    public function a_template_defines_a_base_unit_and_alternatives(): void
    {
        $template = $this->template();

        $this->assertSame('كيس', $template['base_unit']);
        $this->assertSame(50, $template['units'][0]['factor']);

        $product = $this->product($template['id']);
        $this->assertSame(
            [['name' => 'كيس', 'factor' => 1], ['name' => 'طبلية', 'factor' => 50]],
            $product['units']
        );
    }

    /** اختيار قالب الوحدة يجعل وحدة المنتج هي وحدة الأساس، لا قيمة العميل الحرة. */
    /** @test */
    public function creating_a_product_derives_its_unit_from_the_selected_template(): void
    {
        $template = $this->template();

        $product = $this->withToken($this->token)->postJson('/api/products', [
            'name' => 'إسمنت بوحدة صحيحة', 'sku' => 'CEM-' . uniqid(), 'type' => 'good',
            'unit' => 'piece', 'purchase_price' => 1000, 'sale_price' => 2000,
            'unit_template_id' => $template['id'],
        ])->assertCreated()['data'];

        $this->assertSame('كيس', $product['unit']);
        $this->assertSame('كيس', Product::findOrFail($product['id'])->unit);
    }

    /**
     * **جوهر الوحدة.** شراء ٢ طبلية بـ٥٠٠ ريال للطبلية:
     *  • المخزون يزيد ١٠٠ كيساً (٢ × ٥٠)، لا ٢.
     *  • القيد يبقى ١٠٠٠ ريال بالضبط — لا مبلغ تغيّر.
     *  • متوسط التكلفة ٥ ريالات للكيس (١٠٠٠٠٠ هللة ÷ ١٠٠).
     *
     * @test
     */
    public function buying_in_a_larger_unit_stocks_base_units_without_touching_money(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id']);

        $this->buy($product['id'], 2, 50000, 'طبلية')->assertOk();

        $stored = Product::findOrFail($product['id']);
        $this->assertSame(100, $stored->quantity_on_hand, 'الكمية بوحدة المخزون.');
        $this->assertSame(1000, (int) $stored->avg_cost, '١٠٠٠٠٠ هللة ÷ ١٠٠ كيس = ١٠٫٠٠ ريال.');

        // 1140 مدين بالصافي كما هو — بلا أي تحويل نقدي
        $this->assertSame(100000, $this->balance('1140'));
        $this->assertSame(100000, $this->balance('2110'));
    }

    /** ودفتر المخزون يسجّل الكمية بوحدة الأساس لا بوحدة السطر. */
    /** @test */
    public function the_stock_ledger_is_always_in_base_units(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id']);

        $this->buy($product['id'], 2, 50000, 'طبلية')->assertOk();

        $movement = StockMovement::where('product_id', $product['id'])->firstOrFail();
        $this->assertSame(100, $movement->quantity);
        $this->assertSame(100, $movement->balance_quantity);
        $this->assertSame(100000, $movement->total_cost);
    }

    /**
     * **البيع بالمقابل.** رصيد ١٠٠ كيس، بيع طبلية واحدة ⇒ ٥٠ كيساً تخرج،
     * وتكلفة البضاعة المباعة ٥٠ × المتوسط.
     *
     * @test
     */
    public function selling_in_a_larger_unit_issues_base_units(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id']);
        $this->buy($product['id'], 2, 50000, 'طبلية')->assertOk();   // ١٠٠ كيس بمتوسط ١٠

        $this->sell($product['id'], 1, 80000, 'طبلية')->assertOk();  // طبلية بـ٨٠٠ ريال

        $stored = Product::findOrFail($product['id']);
        $this->assertSame(50, $stored->quantity_on_hand);
        $this->assertSame(50000, $this->balance('5110'), 'تكلفة = ٥٠ كيساً × ١٠٫٠٠ ريال.');
        $this->assertSame(80000, $this->balance('4110'), 'الإيراد كما أُدخل: ٨٠٠ ريال.');
    }

    /**
     * **الحارس يقارن بوحدة المخزون.** رصيد ٦٠ كيساً وبيع طبليتين (١٠٠ كيس)
     * يُرفض — ولولا التحويل لقارن «٢» بـ«٦٠» ومرّ.
     *
     * @test
     */
    public function the_negative_stock_guard_compares_in_base_units(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id'], 60, 1000);   // ٦٠ كيساً افتتاحياً

        $this->sell($product['id'], 2, 80000, 'طبلية')->assertStatus(422);

        $this->assertSame(60, Product::findOrFail($product['id'])->quantity_on_hand, 'لا أثر للرفض.');
    }

    /** وبيع طبلية واحدة من ٦٠ كيساً يمرّ — الحدّ حقيقي لا مبالغة. */
    /** @test */
    public function selling_within_stock_in_a_larger_unit_passes(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id'], 60, 1000);

        $this->sell($product['id'], 1, 80000, 'طبلية')->assertOk();

        $this->assertSame(10, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /**
     * **لا تغيير سلوك.** سطرٌ بلا وحدة يُخزَّن بمعامل ١ ويتصرّف كما كان قبل
     * القوالب حرفياً.
     *
     * @test
     */
    public function a_line_without_a_unit_behaves_exactly_as_before(): void
    {
        $product = $this->product(null, 0, 1000);

        $this->buy($product['id'], 10, 1000)->assertOk();

        $stored = Product::findOrFail($product['id']);
        $this->assertSame(10, $stored->quantity_on_hand);
        $this->assertSame(1000, (int) $stored->avg_cost);
        $this->assertSame(10000, $this->balance('1140'));
    }

    /**
     * **الوحدة المجهولة تُرفض ولا يُفترَض لها ١.** معاملٌ مفترَض يُدخل كميةً
     * خاطئة إلى المخزون ثم يُفسد المتوسط — عطلٌ صامت بلا رسالة.
     *
     * @test
     */
    public function an_unknown_unit_is_rejected(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id']);

        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'unit' => 'صندوق']],
        ])->assertStatus(422);

        $this->assertSame(0, JournalEntry::count(), 'الرفض قبل أي قيد.');
    }

    /** ووحدةٌ على منتج بلا قالب تُرفض كذلك. */
    /** @test */
    public function a_unit_on_a_product_without_a_template_is_rejected(): void
    {
        $product = $this->product(null);

        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 1000, 'unit' => 'طبلية']],
        ])->assertStatus(422);
    }

    /**
     * **اللقطة تُجمّد المستند.** تعديل معامل القالب بعد الترحيل لا يعيد تفسير
     * ما رُحِّل: السطر نسخ معامله، وحساب المخزون لا يتحرّك بأثر رجعي.
     *
     * @test
     */
    public function editing_a_template_never_reinterprets_a_posted_document(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id']);
        $this->buy($product['id'], 2, 50000, 'طبلية')->assertOk();

        $before = $this->balance('1140');

        $this->withToken($this->token)->putJson("/api/unit-templates/{$template['id']}", [
            'name' => 'وحدات الإسمنت', 'base_unit' => 'كيس',
            'units' => [['name' => 'طبلية', 'factor' => 40]],   // ٥٠ ⇐ ٤٠
        ])->assertOk();

        $this->assertSame(100, Product::findOrFail($product['id'])->quantity_on_hand, 'الكمية المرحَّلة ثابتة.');
        $this->assertSame($before, $this->balance('1140'));

        // والشراء **الجديد** يستعمل المعامل الجديد
        $this->buy($product['id'], 1, 40000, 'طبلية')->assertOk();
        $this->assertSame(140, Product::findOrFail($product['id'])->quantity_on_hand);
    }

    /** وحدة باسم الأساس تُرفض — معاملان لوحدة واحدة تناقضٌ صامت. */
    /** @test */
    public function a_unit_named_like_the_base_is_rejected(): void
    {
        $this->withToken($this->token)->postJson('/api/unit-templates', [
            'name' => 'قالب', 'base_unit' => 'كيس',
            'units' => [['name' => 'كيس', 'factor' => 5]],
        ])->assertStatus(422);
    }

    /** والمعامل يبدأ من ٢: الوحدة بمعامل ١ هي الأساس باسم آخر. */
    /** @test */
    public function a_factor_of_one_is_rejected(): void
    {
        $this->withToken($this->token)->postJson('/api/unit-templates', [
            'name' => 'قالب', 'base_unit' => 'كيس',
            'units' => [['name' => 'شوال', 'factor' => 1]],
        ])->assertStatus(422);
    }

    /** القالب المستعمَل لا يُحذف. */
    /** @test */
    public function a_template_in_use_cannot_be_deleted(): void
    {
        $template = $this->template();
        $this->product($template['id']);

        $this->withToken($this->token)
            ->deleteJson("/api/unit-templates/{$template['id']}")->assertStatus(422);
    }

    /** العزل بالمستأجر. */
    /** @test */
    public function templates_are_isolated_per_tenant(): void
    {
        $this->template();
        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->assertCount(0, $this->withToken($other['token'])->getJson('/api/unit-templates')['data']);
    }

    /**
     * **القيد المزدوج يظلّ متوازناً** بعد شراء وبيع بوحدات مختلفة — الضمان
     * الأخير الذي لا يُستغنى عنه في أي وحدة تمسّ المخزون.
     *
     * @test
     */
    public function every_entry_stays_balanced_across_mixed_units(): void
    {
        $template = $this->template();
        $product  = $this->product($template['id']);

        $this->buy($product['id'], 2, 50000, 'طبلية')->assertOk();
        $this->sell($product['id'], 30, 1500)->assertOk();          // ٣٠ كيساً بوحدة الأساس
        $this->sell($product['id'], 1, 80000, 'طبلية')->assertOk(); // ٥٠ كيساً

        foreach (JournalEntry::with('lines')->get() as $entry) {
            $this->assertSame(
                $entry->lines->sum('debit'),
                $entry->lines->sum('credit'),
                "القيد {$entry->id} غير متوازن."
            );
        }

        $this->assertSame(20, Product::findOrFail($product['id'])->quantity_on_hand);
    }
}

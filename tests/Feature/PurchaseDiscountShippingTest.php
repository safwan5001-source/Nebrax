<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Purchase;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  خصم وشحن وتسوية على فاتورة الشراء
 * ═══════════════════════════════════════════════════════════════
 *  **القرار الحاكم: الخصم والشحن يدخلان تكلفة البضاعة لا حساباً مستقلاً.**
 *
 *   • الخصم التجاري جزءٌ من ثمن الشراء لا إيراد. ولو رُحِّل إلى حساب مقابل
 *     لدخل المخزون بالمبلغ **قبل** الخصم، فبقي المتوسط المتحرك مضخّماً وخرجت
 *     كل تكلفة بضاعة مباعة لاحقة أعلى من الحقيقة.
 *   • والشحن الوارد من تكلفة الشراء بنصّ IAS 2، فيُرسمَل ليعكس المتوسطُ ما
 *     كلّف الصنفُ فعلاً حتى وصل المخزن.
 *
 *  والثابت الذي تحرسه هذه الاختبارات: **مدين 1140 = Σ(ما دخل دفتر المخزون)**.
 *
 *  تشغيل: php artisan test --filter=PurchaseDiscountShippingTest
 */
class PurchaseDiscountShippingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->token = $this->registerTenant()['token'];
        $this->supplierId = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])
            ->assertCreated()['data']['id'];
    }

    private function product(bool $tracked = true, string $name = 'إسمنت'): string
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => $name, 'sku' => 'S-' . uniqid(), 'type' => 'good',
            'sale_price' => 4000, 'purchase_price' => 1000, 'track_inventory' => $tracked,
        ])->assertCreated()['data']['id'];
    }

    /** يُنشئ ويُرحّل، ويُعيد الفاتورة. */
    private function buy(array $items, array $head = []): array
    {
        $purchase = $this->withToken($this->token)->postJson('/api/purchases', array_merge([
            'partner_id' => $this->supplierId, 'payment_type' => 'credit', 'items' => $items,
        ], $head))->assertCreated()['data'];

        $this->withToken($this->token)->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        return $purchase;
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    /** الثابت الحارس: مدين 1140 يساوي مجموع (كمية × متوسط) لكل صنف. */
    private function assertInventoryInvariant(): void
    {
        $ledger = Product::all()->sum(fn ($p) => $p->quantity_on_hand * $p->avg_cost);

        $this->assertSame(
            $this->balance('1140'),
            (int) $ledger,
            'حساب 1140 يجب أن يساوي Σ(كمية × متوسط تكلفة).'
        );
    }

    /**
     * **خصم السطر.** يخفّض الأساس قبل الضريبة، فتدخل البضاعة بصافيها
     * وتُستردّ مدخلاتٌ على ما دُفع فعلاً لا على ما قبل الخصم.
     *
     * @test
     */
    public function a_line_discount_lowers_both_cost_and_input_vat(): void
    {
        $product = $this->product();

        // ١٠ × ١٠٠٫٠٠ = ١٠٠٠٫٠٠ · خصم ١٠٠٫٠٠ ⇒ الأساس ٩٠٠٫٠٠ · ضريبة ١٣٥٫٠٠
        $this->buy([[
            'product_id' => $product, 'quantity' => 10, 'unit_price' => 10000,
            'tax_rate' => 15, 'discount' => 10000,
        ]]);

        $this->assertSame(90000, $this->balance('1140'));
        $this->assertSame(13500, $this->balance('1150'));
        $this->assertSame(103500, $this->balance('2110'));

        $stored = Product::findOrFail($product);
        $this->assertSame(9000, (int) $stored->avg_cost, 'المتوسط ٩٠٫٠٠ لا ١٠٠٫٠٠.');
        $this->assertInventoryInvariant();
    }

    /**
     * **خصم الفاتورة يخفّض تكلفة المخزون** — لا يُرحَّل إلى حساب مقابل.
     * لو رُحِّل لبقي المتوسط ١٠٠٫٠٠ وكل بيعٍ بعده يُظهر ربحاً أقلّ من الحقيقة.
     *
     * @test
     */
    public function an_invoice_discount_lowers_the_moving_average(): void
    {
        $product = $this->product();

        $this->buy(
            [['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]],
            ['discount' => 10000]
        );

        $this->assertSame(90000, $this->balance('1140'), 'المخزون بالصافي بعد الخصم.');
        $this->assertSame(0, $this->balance('5115'), 'ولا شيء على حساب المسموحات.');
        $this->assertSame(9000, (int) Product::findOrFail($product)->avg_cost);
        $this->assertInventoryInvariant();
    }

    /**
     * **الشحن يُرسمَل** — IAS 2: تكاليف الشراء تشمل النقل. فالمتوسط يعكس ما
     * كلّف الصنفُ حتى وصل المخزن.
     *
     * @test
     */
    public function shipping_is_capitalised_into_inventory(): void
    {
        $product = $this->product();

        // ١٠ × ١٠٠٫٠٠ + شحن ٥٠٫٠٠ ⇒ ١٠٥٠٫٠٠ · ضريبة ١٥٧٫٥٠
        $this->buy(
            [['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]],
            ['shipping' => 5000]
        );

        $this->assertSame(105000, $this->balance('1140'));
        $this->assertSame(15750, $this->balance('1150'));
        $this->assertSame(120750, $this->balance('2110'));
        $this->assertSame(10500, (int) Product::findOrFail($product)->avg_cost, 'المتوسط ١٠٥٫٠٠.');
        $this->assertInventoryInvariant();
    }

    /**
     * **التوزيع نسبيّ بين المخزون والمصروف.** شحنٌ يُحمَّل كلّه على المخزون
     * بينما نصف الفاتورة خدماتٌ يُشوّه تكلفة البضاعة.
     *
     * @test
     */
    public function head_amounts_split_between_inventory_and_expenses(): void
    {
        $goods   = $this->product();
        $service = $this->product(tracked: false, name: 'تخليص');

        // بضاعة ٦٠٠٫٠٠ · خدمة ٤٠٠٫٠٠ ⇒ شحن ١٠٠٫٠٠ يتوزّع ٦٠/٤٠
        $this->buy([
            ['product_id' => $goods, 'quantity' => 6, 'unit_price' => 10000, 'tax_rate' => 0],
            ['product_id' => $service, 'quantity' => 1, 'unit_price' => 40000, 'tax_rate' => 0],
        ], ['shipping' => 10000]);

        $this->assertSame(66000, $this->balance('1140'), '٦٠٠ + ٦٠ = ٦٦٠٫٠٠');
        $this->assertSame(44000, $this->balance('5150'), '٤٠٠ + ٤٠ = ٤٤٠٫٠٠');
        $this->assertSame(110000, $this->balance('2110'));
        $this->assertInventoryInvariant();
    }

    /** والخصم والشحن معاً يتعادلان فلا يتغيّر شيء. */
    /** @test */
    public function a_discount_equal_to_shipping_cancels_out(): void
    {
        $product = $this->product();

        $this->buy(
            [['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]],
            ['discount' => 5000, 'shipping' => 5000]
        );

        $this->assertSame(100000, $this->balance('1140'));
        $this->assertSame(15000, $this->balance('1150'));
        $this->assertSame(10000, (int) Product::findOrFail($product)->avg_cost);
        $this->assertInventoryInvariant();
    }

    /**
     * **التسوية على 5170** — فرق تقريب غير خاضع للضريبة، ويوازن القيد.
     *
     * @test
     */
    public function a_positive_adjustment_debits_the_rounding_account(): void
    {
        $product = $this->product();

        $this->buy(
            [['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 0]],
            ['adjustment' => 250]
        );

        $this->assertSame(100000, $this->balance('1140'), 'التسوية لا تمسّ المخزون.');
        $this->assertSame(250, $this->balance('5170'));
        $this->assertSame(100250, $this->balance('2110'));
        $this->assertInventoryInvariant();
    }

    /** والسالبة تُقيَّد دائنةً على الحساب نفسه. */
    /** @test */
    public function a_negative_adjustment_credits_it(): void
    {
        $product = $this->product();

        $this->buy(
            [['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 0]],
            ['adjustment' => -250]
        );

        $this->assertSame(-250, $this->balance('5170'));
        $this->assertSame(99750, $this->balance('2110'));
        $this->assertInventoryInvariant();
    }

    /** الخصم لا يتجاوز إجمالي السطور. */
    /** @test */
    public function a_discount_beyond_the_subtotal_is_rejected(): void
    {
        $product = $this->product();

        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId,
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 10000]],
            'discount' => 20000,
        ])->assertStatus(422);

        $this->assertSame(0, JournalEntry::count());
    }

    /** وخصم السطر لا يتجاوز السطر. */
    /** @test */
    public function a_line_discount_beyond_the_line_is_rejected(): void
    {
        $product = $this->product();

        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId,
            'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 10000, 'discount' => 20000]],
        ])->assertStatus(422);
    }

    /**
     * **صفر لا يغيّر شيئاً.** فاتورة بلا خصم ولا شحن ولا تسوية تُرحَّل كما
     * كانت قبل هذه الوحدة حرفياً — لا تغيير سلوك على ما بُني قبلها.
     *
     * @test
     */
    public function zero_values_change_nothing(): void
    {
        $product = $this->product();

        $this->buy([['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]]);

        $this->assertSame(100000, $this->balance('1140'));
        $this->assertSame(15000, $this->balance('1150'));
        $this->assertSame(115000, $this->balance('2110'));
        $this->assertSame(10000, (int) Product::findOrFail($product)->avg_cost);
        $this->assertInventoryInvariant();
    }

    /** والقيد متوازن في كل الحالات. */
    /** @test */
    public function every_entry_stays_balanced(): void
    {
        $goods   = $this->product();
        $service = $this->product(tracked: false, name: 'شحن');

        $this->buy([
            ['product_id' => $goods, 'quantity' => 7, 'unit_price' => 13333, 'tax_rate' => 15, 'discount' => 999],
            ['product_id' => $service, 'quantity' => 1, 'unit_price' => 7777, 'tax_rate' => 15],
        ], ['discount' => 1234, 'shipping' => 4321, 'adjustment' => -77]);

        foreach (JournalEntry::with('lines')->get() as $entry) {
            $this->assertSame(
                $entry->lines->sum('debit'),
                $entry->lines->sum('credit'),
                "القيد {$entry->id} غير متوازن."
            );
        }

        $this->assertInventoryInvariant();
    }

    /** والإجمالي المخزَّن يطابق ما يُرحَّل دائناً. */
    /** @test */
    public function the_stored_total_matches_the_credit_side(): void
    {
        $product = $this->product();

        $purchase = $this->buy(
            [['product_id' => $product, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]],
            ['discount' => 10000, 'shipping' => 5000, 'adjustment' => 100]
        );

        $stored = Purchase::findOrFail($purchase['id']);
        $this->assertSame($this->balance('2110'), (int) $stored->total);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  فاتورة شراء بمنتج — البضاعة أصلٌ لا مصروف
 * ═══════════════════════════════════════════════════════════════
 *  شاشة إنشاء فاتورة الشراء لم تكن تختار منتجاً، فكل سطورها وصفية وتسقط في
 *  **5150 مصروفات عامة**: القيد متوازن، لكن ما هو أصلٌ في المخزن يُصرَف
 *  مصروف الفترة — فتُظهر قائمة الدخل خسارةً مضخّمة، والميزانية أصولاً ناقصة،
 *  ولا تدخل كمية ولا يتحرّك متوسط.
 *
 *  هذه الاختبارات تثبّت الفرق بين الحالتين بالحساب والرقم، وتحرس من ارتداد
 *  التوجيه إلى 5150 حين يُحدَّد منتج متابَع.
 *
 *  تشغيل: php artisan test --filter=PurchaseWithProductTest
 */
class PurchaseWithProductTest extends TestCase
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

    private function product(bool $tracked = true, string $name = 'إسمنت'): array
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => $name, 'sku' => 'CEM-' . uniqid(), 'type' => 'good',
            'purchase_price' => 1000, 'sale_price' => 2000, 'track_inventory' => $tracked,
        ])->assertCreated()['data'];
    }

    private function buy(array $item, array $head = [])
    {
        $purchase = $this->withToken($this->token)->postJson('/api/purchases', array_merge([
            'partner_id' => $this->supplierId, 'payment_type' => 'credit', 'items' => [$item],
        ], $head))->assertCreated()['data'];

        $this->withToken($this->token)->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        return $purchase;
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    /**
     * **جوهر الإصلاح.** سطرٌ بمنتج متابَع ⇒ مدين **1140 المخزون**، والكمية
     * تدخل فعلاً ويُضبط المتوسط.
     *
     * @test
     */
    public function a_line_with_a_tracked_product_debits_inventory(): void
    {
        $product = $this->product();

        $this->buy(['product_id' => $product['id'], 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 0]);

        $this->assertSame(10000, $this->balance('1140'), 'البضاعة أصل.');
        $this->assertSame(0, $this->balance('5150'), 'ولا شيء في المصروفات العامة.');

        $stored = Product::findOrFail($product['id']);
        $this->assertSame(10, $stored->quantity_on_hand);
        $this->assertSame(1000, (int) $stored->avg_cost);
    }

    /**
     * **المنتج إلزامي.** السطر بلا منتج كان يسقط في «5150 مصروفات عامة» بلا
     * تمييزٍ بين بضاعةٍ تُرسمَل ومصروفِ فترة — فيُرفض الآن برسالة تدلّ على
     * البديل.
     *
     * @test
     */
    public function a_line_without_a_product_is_rejected(): void
    {
        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [['description' => 'إسمنت', 'quantity' => 10, 'unit_price' => 1000]],
        ])->assertStatus(422)->assertJsonValidationErrors('items.0.product_id');

        $this->assertSame(0, JournalEntry::count(), 'لا قيد.');
    }

    /**
     * **مسار المصروف لم يُغلَق، بل صار مُدارَاً.** الشحن والتخليص يُدخَلان
     * بمنتج **خدمي غير متابَع مخزونياً** فيبقى ترحيلهما إلى 5150 كما كان —
     * لكنهما بندٌ يُبحث عنه ويُقاس لا نصٌّ حرّ يُكتب في كل مرة بإملاء مختلف.
     *
     * @test
     */
    public function a_mixed_invoice_splits_between_inventory_and_expenses(): void
    {
        $product = $this->product();
        $service = $this->product(tracked: false, name: 'تخليص جمركي');

        $purchase = $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [
                ['product_id' => $product['id'], 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 0],
                ['product_id' => $service['id'], 'quantity' => 1, 'unit_price' => 3000, 'tax_rate' => 0],
            ],
        ])->assertCreated()['data'];
        $this->withToken($this->token)->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        $this->assertSame(10000, $this->balance('1140'));
        $this->assertSame(3000, $this->balance('5150'));
        $this->assertSame(13000, $this->balance('2110'));
    }

    /** منتج غير متابَع مخزونياً (خدمة) يبقى مصروفاً — التتبع هو الفاصل لا وجود المنتج. */
    /** @test */
    public function an_untracked_product_still_goes_to_expenses(): void
    {
        $product = $this->product(tracked: false);

        $this->buy(['product_id' => $product['id'], 'quantity' => 2, 'unit_price' => 5000, 'tax_rate' => 0]);

        $this->assertSame(10000, $this->balance('5150'));
        $this->assertSame(0, $this->balance('1140'));
    }

    /** الضريبة تفترق عن الاثنين: 1150 ضريبة مدخلات مهما كان نوع السطر. */
    /** @test */
    public function input_vat_is_separate_from_both(): void
    {
        $product = $this->product();

        $this->buy(['product_id' => $product['id'], 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 15]);

        $this->assertSame(10000, $this->balance('1140'));
        $this->assertSame(1500, $this->balance('1150'));
        $this->assertSame(11500, $this->balance('2110'));
    }

    /**
     * **مركز التكلفة يوسم المصروف وحده.** المخزون أصلٌ يصير تكلفةً حين يُباع
     * فيُوسَم قيد تكلفة البضاعة المباعة؛ وضريبة المدخلات ذمّةٌ على الدولة لا
     * مصروف مركز. وسمُهما كان يُضخّم تكلفة المركز بما لم يُستهلك بعد.
     *
     * @test
     */
    public function the_cost_center_tags_the_expense_line_only(): void
    {
        $center = $this->withToken($this->token)
            ->postJson('/api/cost-centers', ['code' => 'CC-1', 'name' => 'مشروع الدمام'])
            ->assertCreated()['data'];
        $product = $this->product();
        $service = $this->product(tracked: false, name: 'تخليص جمركي');

        $purchase = $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'cost_center_id' => $center['id'],
            'items' => [
                ['product_id' => $product['id'], 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 15],
                ['product_id' => $service['id'], 'quantity' => 1, 'unit_price' => 3000, 'tax_rate' => 15],
            ],
        ])->assertCreated()['data'];
        $this->withToken($this->token)->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        $entry = JournalEntry::with('lines.account')->latest('created_at')->firstOrFail();
        $tagged = $entry->lines->filter(fn ($l) => $l->cost_center_id === $center['id']);

        $this->assertCount(1, $tagged, 'سطر واحد موسوم.');
        $this->assertSame('5150', $tagged->first()->account->code);
        $this->assertSame(3000, (int) $tagged->first()->debit);
    }

    /** مركز تكلفة من مستأجر آخر يُرفض. */
    /** @test */
    public function a_cost_center_from_another_tenant_is_rejected(): void
    {
        $other = $this->registerTenant('other', 'other@nibras.test');
        $theirs = $this->withToken($other['token'])
            ->postJson('/api/cost-centers', ['code' => 'CC-X', 'name' => 'مركزهم'])
            ->assertCreated()['data'];

        $this->withToken($this->token)->postJson('/api/purchases', [
            'partner_id' => $this->supplierId, 'cost_center_id' => $theirs['id'],
            'items' => [['product_id' => $this->product()['id'], 'quantity' => 1, 'unit_price' => 1000]],
        ])->assertStatus(422);
    }

    /** والقيد متوازن في كل الحالات. */
    /** @test */
    public function every_purchase_entry_stays_balanced(): void
    {
        $product = $this->product();

        $service = $this->product(tracked: false, name: 'شحن');
        $this->buy(['product_id' => $product['id'], 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 15]);
        $this->buy(['product_id' => $service['id'], 'quantity' => 1, 'unit_price' => 2500, 'tax_rate' => 15]);

        foreach (JournalEntry::with('lines')->get() as $entry) {
            $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        }
    }
}

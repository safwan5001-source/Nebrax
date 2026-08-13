<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تعديل فاتورة الشراء وحذفها — **المسوّدة فقط**
 * ═══════════════════════════════════════════════════════════════
 *  المرحّلة `immutable`: لها قيدٌ في الدفتر **وحركةُ مخزون غيّرت المتوسط
 *  المتحرك**. تعديلها يترك القيد يشهد على مبلغٍ لم يعد موجوداً، وحذفها يترك
 *  قيداً بلا مستند — وكلاهما يكسر الأثر الرجعي.
 *
 *  فاتورة الشراء أخطر من فاتورة البيع في هذا الباب: البيع يخفض المخزون
 *  بمتوسطٍ قائم، أمّا الشراء **فيعيد حساب المتوسط نفسه** — فتعديلٌ بعد
 *  الترحيل يُفسد تكلفة كل بيعٍ تالٍ.
 *
 *  تشغيل: php artisan test --filter=PurchaseEditDeleteTest
 */
class PurchaseEditDeleteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private string $supplierId;
    private string $productId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->token = $this->registerTenant()['token'];
        $this->supplierId = $this->withToken($this->token)
            ->postJson('/api/partners', ['name' => 'مورد', 'type' => 'supplier'])
            ->assertCreated()['data']['id'];
        $this->productId = $this->product();
    }

    private function product(string $name = 'إسمنت'): string
    {
        return $this->withToken($this->token)->postJson('/api/products', [
            'name' => $name, 'sku' => 'S-' . uniqid(), 'type' => 'good',
            'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
    }

    /** مسوّدة بسطر واحد. */
    private function draft(array $overrides = []): array
    {
        return $this->withToken($this->token)->postJson('/api/purchases', array_merge([
            'partner_id' => $this->supplierId, 'payment_type' => 'credit',
            'items' => [['product_id' => $this->productId, 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 0]],
        ], $overrides))->assertCreated()['data'];
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    /** التعديل يعيد بناء السطور والإجماليات من المُرسَل. */
    /** @test */
    public function a_draft_can_be_edited(): void
    {
        $draft = $this->draft();

        $this->withToken($this->token)->putJson("/api/purchases/{$draft['id']}", [
            'partner_id' => $this->supplierId, 'payment_type' => 'cash',
            'items' => [['product_id' => $this->productId, 'quantity' => 4, 'unit_price' => 2500, 'tax_rate' => 0]],
        ])->assertOk();

        $stored = Purchase::findOrFail($draft['id']);
        $this->assertSame(10000, (int) $stored->total, '٤ × ٢٥٫٠٠ = ١٠٠٫٠٠');
        $this->assertSame('cash', $stored->payment_type);
        $this->assertCount(1, $stored->lines, 'السطور تُبنى من جديد لا تُضاف.');
        $this->assertSame(4, $stored->lines->first()->quantity);
    }

    /**
     * **جوهر القاعدة.** المرحّلة لا تُعدَّل: قيدها في الدفتر ومتوسط تكلفتها
     * محسوبٌ منها.
     *
     * @test
     */
    public function a_posted_purchase_cannot_be_edited(): void
    {
        $draft = $this->draft();
        $this->withToken($this->token)->postJson("/api/purchases/{$draft['id']}/post")->assertOk();

        $before = $this->balance('1140');

        $this->withToken($this->token)->putJson("/api/purchases/{$draft['id']}", [
            'partner_id' => $this->supplierId,
            'items' => [['product_id' => $this->productId, 'quantity' => 1, 'unit_price' => 1, 'tax_rate' => 0]],
        ])->assertStatus(422);

        $this->assertSame($before, $this->balance('1140'), 'الرفض لا يترك أثراً.');
        $this->assertSame(10000, (int) Purchase::findOrFail($draft['id'])->total);
        $this->assertSame(10, Product::findOrFail($this->productId)->quantity_on_hand);
    }

    /** ولا تُحذف — قيدٌ بلا مستند أسوأ من مستندٍ خاطئ. */
    /** @test */
    public function a_posted_purchase_cannot_be_deleted(): void
    {
        $draft = $this->draft();
        $this->withToken($this->token)->postJson("/api/purchases/{$draft['id']}/post")->assertOk();

        $this->withToken($this->token)->deleteJson("/api/purchases/{$draft['id']}")->assertStatus(422);

        $this->assertNotNull(Purchase::find($draft['id']));
        $this->assertSame(1, JournalEntry::count());
    }

    /** المسوّدة تُحذف هي وسطورها — لا قيد لها أصلاً. */
    /** @test */
    public function a_draft_is_deleted_with_its_lines(): void
    {
        $draft = $this->draft();

        $this->withToken($this->token)->deleteJson("/api/purchases/{$draft['id']}")->assertOk();

        $this->assertNull(Purchase::find($draft['id']));
        $this->assertSame(0, PurchaseLine::where('purchase_id', $draft['id'])->count());
        $this->assertSame(0, JournalEntry::count());
    }

    /**
     * **الغائب يبقى، والمُرسَل فارغاً يُمحى.** تعديلٌ لا يرسل `tax_inclusive`
     * يجب ألّا يقلبها إلى `false` فيغيّر الإجمالي في فاتورة لم يُمسّ مبلغُها —
     * نفس علّة الفواتير (#166).
     *
     * @test
     */
    public function omitting_a_field_does_not_erase_it(): void
    {
        $draft = $this->draft(['tax_inclusive' => true, 'notes' => 'ملاحظة']);
        $this->assertTrue((bool) Purchase::findOrFail($draft['id'])->tax_inclusive);

        // تعديل الكمية وحدها — بلا `tax_inclusive`
        $this->withToken($this->token)->putJson("/api/purchases/{$draft['id']}", [
            'partner_id' => $this->supplierId,
            'items' => [['product_id' => $this->productId, 'quantity' => 2, 'unit_price' => 11500, 'tax_rate' => 15]],
        ])->assertOk();

        $stored = Purchase::findOrFail($draft['id']);
        $this->assertTrue((bool) $stored->tax_inclusive, 'الوضع الضريبي لم يُرسَل فبقي.');
        $this->assertSame('ملاحظة', $stored->notes, 'والملاحظة كذلك.');
        // متضمَّن: ٢٣٠٫٠٠ إجمالاً، صافيها ٢٠٠٫٠٠ وضريبتها ٣٠٫٠٠
        $this->assertSame(23000, (int) $stored->total);
        $this->assertSame(20000, (int) $stored->subtotal);
    }

    /** ومركز التكلفة يُمحى إن أُرسل فارغاً صراحةً. */
    /** @test */
    public function sending_a_field_empty_does_erase_it(): void
    {
        $center = $this->withToken($this->token)
            ->postJson('/api/cost-centers', ['code' => 'CC-1', 'name' => 'مشروع'])
            ->assertCreated()['data'];
        $draft = $this->draft(['cost_center_id' => $center['id']]);

        $this->withToken($this->token)->putJson("/api/purchases/{$draft['id']}", [
            'partner_id' => $this->supplierId, 'cost_center_id' => null,
            'items' => [['product_id' => $this->productId, 'quantity' => 1, 'unit_price' => 1000]],
        ])->assertOk();

        $this->assertNull(Purchase::findOrFail($draft['id'])->cost_center_id);
    }

    /** التعديل يخضع لقاعدة إلزام المنتج نفسها. */
    /** @test */
    public function editing_still_requires_a_product_on_every_line(): void
    {
        $draft = $this->draft();

        $this->withToken($this->token)->putJson("/api/purchases/{$draft['id']}", [
            'partner_id' => $this->supplierId,
            'items' => [['description' => 'بند', 'quantity' => 1, 'unit_price' => 1000]],
        ])->assertStatus(422)->assertJsonValidationErrors('items.0.product_id');
    }

    /** ومسوّدة مستأجر آخر لا تُعدَّل ولا تُحذف — العزل قبل كل شيء. */
    /** @test */
    public function another_tenants_draft_is_invisible(): void
    {
        $draft = $this->draft();
        $other = $this->registerTenant('other', 'other@nibras.test');

        $this->withToken($other['token'])->putJson("/api/purchases/{$draft['id']}", [
            'partner_id' => $this->supplierId,
            'items' => [['product_id' => $this->productId, 'quantity' => 1, 'unit_price' => 1000]],
        ])->assertNotFound();

        $this->withToken($other['token'])->deleteJson("/api/purchases/{$draft['id']}")->assertNotFound();

        // فحصٌ خام: `Purchase::find` هنا يجري تحت سياق المستأجر الآخر فيُخفيه
        // الـ scope، فيبدو الصفّ محذوفاً وهو باقٍ — التوكيد يجب أن يتجاوز العزل.
        $this->assertTrue(DB::table('purchases')->where('id', $draft['id'])->exists());
    }
}

<?php
namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * وصف سطر مستند الشراء المخصَّص و`product_id` قيمتان متوازيتان لا تُلغي إحداهما الأخرى.
 *
 * كان معالج الوصف في محرر مستندات الشراء (طلب شراء، RFQ، عرض سعر، أمر شراء) يمسح
 * `product_id` مع كل ضغطة مفتاح، فيُحفَظ المستند بسطرٍ بلا منتج. وعند تحويل أمر
 * الشراء إلى فاتورة مشتريات وترحيلها لا يُستلَم مخزون ولا يتحرّك متوسط التكلفة،
 * ويُرسَّم ما هو بضاعة مصروفاً. الإصلاح في الواجهة؛ وهذا الاختبار يثبّت عقد
 * الخلفية الذي يعتمد عليه: الحمولة التي فيها القيمتان معاً تُحفَظ وتُنسَخ عبر
 * السلسلة وتُرحَّل وتُقرأ كما هي، دون أن يتغيّر مال ولا ضريبة ولا مخزون ولا قيد.
 *
 * تشغيل:  php artisan test --filter=ProcurementLineProductLinkTest
 */
class ProcurementLineProductLinkTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CUSTOM = 'كرتون ورق A4 — دفعة مارس مع التوصيل';

    private array $auth;
    private string $supplierId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->supplierId = $this->supplier($this->auth['token']);
    }

    private function supplier(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'مورد الورق', 'type' => 'supplier',
        ])->assertCreated()['data']['id'];
    }

    private function product(string $name = 'كرتون ورق A4', bool $tracked = true): array
    {
        return $this->withToken($this->auth['token'])->postJson('/api/products', [
            'name' => $name, 'sku' => 'A4-'.uniqid(), 'type' => 'good',
            'purchase_price' => 1000, 'sale_price' => 2000, 'track_inventory' => $tracked,
        ])->assertCreated()['data'];
    }

    private function body(string $type, array $line): array
    {
        return array_filter([
            'type' => $type,
            'partner_id' => in_array($type, ['order', 'quotation'], true) ? $this->supplierId : null,
            'items' => [array_merge(['quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 15], $line)],
        ], fn ($v) => $v !== null);
    }

    private function doc(string $type, array $line, ?string $token = null): array
    {
        return $this->withToken($token ?? $this->auth['token'])
            ->postJson('/api/procurement', $this->body($type, $line))->assertCreated()['data'];
    }

    private function approve(string $id): void
    {
        $this->withToken($this->auth['token'])->postJson("/api/procurement/{$id}/transition", ['status' => 'submitted'])->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/procurement/{$id}/transition", ['status' => 'approved'])->assertOk();
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    /** بصمة مالية ومخزونية لا تتضمن المعرّفات ولا النصوص — لمقارنة فاتورتين متكافئتين. */
    private function fingerprint(string $purchaseId, string $productId): array
    {
        $purchase = Purchase::with('lines')->findOrFail($purchaseId);
        $entries = JournalEntry::with('lines.account')
            ->where('source_type', Purchase::class)->where('source_id', $purchaseId)->get();
        $journal = $entries->flatMap(fn (JournalEntry $e) => $e->lines->map(
            fn ($l) => $l->account->code.':'.$l->debit.':'.$l->credit
        ))->sort()->values()->all();
        $stock = StockMovement::where('source_type', Purchase::class)->where('source_id', $purchaseId)
            ->get()->map(fn (StockMovement $m) => $m->type.':'.$m->quantity.':'.$m->unit_cost.':'.$m->total_cost)
            ->sort()->values()->all();
        $product = Product::findOrFail($productId);

        return [
            'totals' => [$purchase->subtotal, $purchase->tax_amount, $purchase->total],
            'line' => $purchase->lines->map(fn ($l) => [
                $l->quantity, $l->unit_price, $l->tax_rate, $l->line_subtotal, $l->line_tax, $l->line_total,
            ])->all(),
            'journal' => $journal,
            'stock' => $stock,
            'on_hand' => (int) $product->quantity_on_hand,
            'avg_cost' => (int) $product->avg_cost,
        ];
    }

    /**
     * @test
     * @dataProvider types
     */
    public function each_document_type_saves_both_the_product_and_the_customized_description(string $type): void
    {
        $product = $this->product();
        $doc = $this->doc($type, ['product_id' => $product['id'], 'description' => self::CUSTOM]);

        $this->withToken($this->auth['token'])->getJson('/api/procurement/'.$doc['id'])->assertOk()
            ->assertJsonPath('data.type', $type)
            ->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
        $this->assertDatabaseHas('procurement_lines', [
            'procurement_document_id' => $doc['id'], 'product_id' => $product['id'], 'description' => self::CUSTOM,
        ]);
    }

    public static function types(): array
    {
        return ['purchase order' => ['order'], 'purchase quotation' => ['quotation'], 'purchase request' => ['request'], 'RFQ' => ['rfq']];
    }

    /** @test */
    public function the_conversion_chain_copies_both_values_to_every_next_document(): void
    {
        $product = $this->product();
        $request = $this->doc('request', ['product_id' => $product['id'], 'description' => self::CUSTOM]);
        $this->approve($request['id']);

        $rfq = $this->withToken($this->auth['token'])->postJson("/api/procurement/{$request['id']}/convert", ['target' => 'rfq'])
            ->assertCreated()->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)['data'];
        $this->approve($rfq['id']);

        $quotation = $this->withToken($this->auth['token'])->postJson("/api/procurement/{$rfq['id']}/convert", [
            'target' => 'quotation', 'partner_id' => $this->supplierId,
        ])->assertCreated()->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)['data'];
        $this->approve($quotation['id']);

        $this->withToken($this->auth['token'])->postJson("/api/procurement/{$quotation['id']}/convert", ['target' => 'order'])
            ->assertCreated()->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
    }

    /** @test */
    public function converting_an_order_to_a_purchase_and_posting_it_preserves_both_values_and_receives_stock(): void
    {
        $product = $this->product();
        $order = $this->doc('order', ['product_id' => $product['id'], 'description' => self::CUSTOM]);
        $this->approve($order['id']);

        $purchase = $this->withToken($this->auth['token'])->postJson("/api/procurement/{$order['id']}/convert", ['target' => 'purchase'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)['data'];
        // المسودة بلا قيد ولا مخزون.
        $this->assertSame(0, JournalEntry::where('source_type', Purchase::class)->where('source_id', $purchase['id'])->count());
        $this->assertSame(0, (int) Product::findOrFail($product['id'])->quantity_on_hand);

        $this->withToken($this->auth['token'])->postJson("/api/purchases/{$purchase['id']}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson('/api/purchases/'.$purchase['id'])->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product['id'])
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
        $this->assertDatabaseHas('purchase_lines', [
            'purchase_id' => $purchase['id'], 'product_id' => $product['id'], 'description' => self::CUSTOM,
        ]);

        // الربط هو ما يجعل البضاعة أصلاً في المخزون لا مصروفاً: 1140 مدين، 1150 ضريبة، 2110 الذمة.
        $this->assertSame(10000, $this->balance('1140'));
        $this->assertSame(1500, $this->balance('1150'));
        $this->assertSame(11500, $this->balance('2110'));
        $this->assertSame(0, $this->balance('5150'));
        $stored = Product::findOrFail($product['id']);
        $this->assertSame(10, (int) $stored->quantity_on_hand);
        $this->assertSame(1000, (int) $stored->avg_cost);
        $this->assertNotEmpty(StockMovement::where('source_type', Purchase::class)->where('source_id', $purchase['id'])->get());
    }

    /** @test */
    public function a_custom_description_changes_no_money_vat_inventory_or_journal_entry(): void
    {
        $plain = $this->product('P-PLAIN');
        $custom = $this->product('P-CUSTOM');

        $ids = [];
        foreach ([[$plain, []], [$custom, ['description' => self::CUSTOM]]] as [$product, $extra]) {
            $order = $this->doc('order', array_merge(['product_id' => $product['id']], $extra));
            $this->approve($order['id']);
            $purchase = $this->withToken($this->auth['token'])->postJson("/api/procurement/{$order['id']}/convert", ['target' => 'purchase'])
                ->assertCreated()['data'];
            $this->withToken($this->auth['token'])->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();
            $ids[] = $purchase['id'];
        }

        $a = $this->fingerprint($ids[0], $plain['id']);
        $b = $this->fingerprint($ids[1], $custom['id']);
        $this->assertSame($a, $b);
        $this->assertSame(self::CUSTOM, Purchase::findOrFail($ids[1])->lines->first()->description);

        // الأثر المخزوني والمحاسبي حقيقيان لا فارغان — وإلا كانت المقارنة بلا معنى.
        $this->assertNotEmpty($b['stock']);
        $this->assertNotEmpty($b['journal']);
        $this->assertSame(10, $b['on_hand']);
    }

    /** @test */
    public function a_line_without_a_custom_description_still_keeps_the_product_link(): void
    {
        $product = $this->product();
        $doc = $this->doc('order', ['product_id' => $product['id']]);

        $this->withToken($this->auth['token'])->getJson('/api/procurement/'.$doc['id'])->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product['id']);
    }

    /**
     * السطر اليدوي (بلا منتج) سلوكٌ قائم يبقى كما هو: يُحفَظ بلا منتج ويُحوَّل ويُرحَّل مصروفاً
     * في 5150 بلا حركة مخزون. هذا هو المسار الذي كان العيب يدفع إليه سطراً مرتبطاً بمنتج دون
     * قصد المستخدم — ويُوثَّق هنا ولا يُغيَّر (قاعدة «المنتج إلزامي» تحرس `POST /api/purchases`
     * وحده، لا التحويل من أمر الشراء).
     *
     * @test
     */
    public function an_explicit_manual_line_stays_manual_and_posts_as_an_expense_without_stock(): void
    {
        $order = $this->doc('order', ['description' => 'رسوم شحن']);
        $this->approve($order['id']);

        $this->withToken($this->auth['token'])->getJson('/api/procurement/'.$order['id'])
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'رسوم شحن');

        $purchase = $this->withToken($this->auth['token'])->postJson("/api/procurement/{$order['id']}/convert", ['target' => 'purchase'])
            ->assertCreated()->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'رسوم شحن')['data'];
        $this->withToken($this->auth['token'])->postJson("/api/purchases/{$purchase['id']}/post")->assertOk();

        $this->assertSame(10000, $this->balance('5150'));
        $this->assertSame(0, $this->balance('1140'));
        $this->assertSame(0, StockMovement::where('source_type', Purchase::class)->where('source_id', $purchase['id'])->count());
    }

    /** @test */
    public function a_user_without_purchase_management_cannot_create_or_convert_a_document_with_both_values(): void
    {
        $staff = $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@procurement-line.test');
        $product = $this->product();
        $order = $this->doc('order', ['product_id' => $product['id'], 'description' => 'قبل']);
        $this->approve($order['id']);

        $this->withToken($staff)->postJson('/api/procurement', $this->body('order', [
            'product_id' => $product['id'], 'description' => self::CUSTOM,
        ]))->assertForbidden();
        $this->withToken($staff)->postJson("/api/procurement/{$order['id']}/convert", ['target' => 'purchase'])->assertForbidden();

        $this->withToken($this->auth['token'])->getJson('/api/procurement/'.$order['id'])
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.lines.0.description', 'قبل');
    }

    /** @test */
    public function another_tenant_can_neither_read_convert_nor_link_the_product(): void
    {
        $product = $this->product();
        $order = $this->doc('order', ['product_id' => $product['id'], 'description' => self::CUSTOM]);
        $this->approve($order['id']);

        $other = $this->registerTenant('beta', 'owner@beta.test');
        $otherSupplier = $this->supplier($other['token']);

        $this->withToken($other['token'])->getJson('/api/procurement/'.$order['id'])->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/procurement/{$order['id']}/convert", ['target' => 'purchase'])->assertNotFound();
        // منتج مستأجر آخر لا يُربط بسطر — حتى مع وصفٍ صالح.
        $this->withToken($other['token'])->postJson('/api/procurement', [
            'type' => 'order', 'partner_id' => $otherSupplier,
            'items' => [['product_id' => $product['id'], 'description' => 'تسلل', 'quantity' => 1, 'unit_price' => 1000]],
        ])->assertStatus(422);

        // لم يتغيّر شيء عند المالك: بلا فاتورة ولا قيد، والمستند على حاله.
        $this->assertDatabaseHas('procurement_documents', ['id' => $order['id'], 'status' => 'approved']);
        $this->assertDatabaseHas('procurement_lines', [
            'procurement_document_id' => $order['id'], 'product_id' => $product['id'], 'description' => self::CUSTOM,
        ]);
        $this->assertSame(0, JournalEntry::where('source_type', Purchase::class)->count());
    }
}

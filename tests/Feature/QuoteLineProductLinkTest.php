<?php
namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\Quote;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * وصف السطر المخصَّص و`product_id` قيمتان متوازيتان في عرض السعر.
 *
 * كان معالج الوصف في شاشة عرض السعر يمسح `product_id` مع كل ضغطة مفتاح، فيُحفَظ العرض
 * بسطرٍ بلا منتج، ويتحوّل إلى فاتورة مبيعات بلا منتج فيفلت من المخزون والتكلفة.
 * الإصلاح في الواجهة؛ وهذا الاختبار يثبّت عقد الخلفية الذي يعتمد عليه: الحمولة التي
 * فيها الاثنان معاً تُحفَظ وتُسترجَع وتُحوَّل وتُرحَّل دون أن يتغيّر مال أو ضريبة أو
 * مخزون أو قيد.
 *
 * تشغيل:  php artisan test --filter=QuoteLineProductLinkTest
 */
class QuoteLineProductLinkTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CUSTOM = 'كرتون ورق A4 — مع التوصيل';

    private array $auth;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
    }

    private function partner(?string $token = null): string
    {
        return $this->withToken($token ?? $this->auth['token'])->postJson('/api/partners', [
            'name' => 'عميل العرض', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    private function product(string $sku = 'A4-1', string $name = 'كرتون ورق A4'): Product
    {
        $product = Product::create([
            'tenant_id' => $this->auth['tenant_id'], 'name' => $name, 'sku' => $sku,
            'type' => 'good', 'track_inventory' => true, 'sale_price' => 9500, 'tax_rate' => 15,
        ]);
        // الرصيد يُستقبَل عبر خدمة المخزون (رصيد المستودع + حركة + متوسط التكلفة) لا بتعبئة عمود.
        $warehouse = Warehouse::first() ?? Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $warehouse->id]);

        return $product->fresh();
    }

    private function payload(string $partnerId, array $line): array
    {
        return [
            'partner_id' => $partnerId,
            'items' => [array_merge(['quantity' => 3, 'unit_price' => 9500, 'tax_rate' => 15], $line)],
        ];
    }

    /** بصمة مالية ومخزونية لا تتضمن المعرّفات ولا النصوص — لمقارنة فاتورتين متكافئتين. */
    private function fingerprint(string $invoiceId, string $productId): array
    {
        $invoice = Invoice::with('lines')->findOrFail($invoiceId);
        $entries = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $invoiceId)->get();
        $journal = $entries->flatMap(fn (JournalEntry $e) => $e->lines->map(
            fn ($l) => $l->account->code.':'.$l->debit.':'.$l->credit
        ))->sort()->values()->all();
        $stock = StockMovement::where('source_type', Invoice::class)->where('source_id', $invoiceId)
            ->get()->map(fn (StockMovement $m) => $m->type.':'.$m->quantity.':'.$m->unit_cost.':'.$m->total_cost)
            ->sort()->values()->all();

        return [
            'totals' => [$invoice->subtotal, $invoice->tax_amount, $invoice->total],
            'line' => $invoice->lines->map(fn ($l) => [
                $l->quantity, $l->unit_price, $l->tax_rate, $l->line_subtotal, $l->line_tax, $l->line_total,
            ])->all(),
            'journal' => $journal,
            'stock' => $stock,
            'on_hand' => (int) Product::findOrFail($productId)->quantity_on_hand,
        ];
    }

    /** @test */
    public function saving_a_quote_keeps_both_the_product_and_the_customized_description_and_returns_them_on_reload(): void
    {
        $product = $this->product();
        $created = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson('/api/quotes/'.$created['data']['id'])->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->assertDatabaseHas('quote_lines', [
            'quote_id' => $created['data']['id'], 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);
    }

    /** @test */
    public function converting_a_quote_creates_a_draft_invoice_that_keeps_both_values(): void
    {
        $product = $this->product();
        $quoteId = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $invoice = $this->withToken($this->auth['token'])->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)['data'];

        // المسودة بلا قيد ولا حركة مخزون — الأثر يبدأ عند الترحيل وحده.
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice['id'])->count());
        $this->assertSame(0, StockMovement::where('source_type', Invoice::class)->where('source_id', $invoice['id'])->count());
        $this->assertSame(10, (int) Product::findOrFail($product->id)->quantity_on_hand);

        $this->withToken($this->auth['token'])->getJson("/api/quotes/{$quoteId}")->assertOk()
            ->assertJsonPath('data.status', 'converted')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
    }

    /** @test */
    public function posting_the_converted_invoice_preserves_both_values_and_follows_the_existing_inventory_and_accounting_rules(): void
    {
        $product = $this->product();
        $quoteId = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];
        $invoiceId = $this->withToken($this->auth['token'])->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated()['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$invoiceId}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)
            // لقطة الهوية تبقى اسمَ المنتج؛ الوصف المخصّص لا يطمسها.
            ->assertJsonPath('data.lines.0.product_name', 'كرتون ورق A4');

        $this->assertDatabaseHas('invoice_lines', [
            'invoice_id' => $invoiceId, 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);

        // الأثر المخزوني والمحاسبي: المنتج المتابَع يخرج من المخزون (10 − 3)، والقيد متوازن.
        $this->assertSame(7, (int) Product::findOrFail($product->id)->quantity_on_hand);
        $this->assertNotEmpty(StockMovement::where('source_type', Invoice::class)->where('source_id', $invoiceId)->get());
        $this->assertNotEmpty(JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoiceId)->get());
    }

    /**
     * بصمة مالية ومخزونية: عرضان متطابقان في كل شيء إلا الوصف المخصّص يتحوّلان إلى فاتورتين
     * تنتجان الأثر نفسه بالضبط — المجاميع والضريبة والقيد والمخزون والرصيد.
     *
     * @test
     */
    public function a_custom_description_changes_no_money_vat_inventory_or_journal_entry(): void
    {
        $plain = $this->product('P-PLAIN');
        $custom = $this->product('P-CUSTOM');
        $partnerId = $this->partner();

        $ids = [];
        foreach ([[$plain, []], [$custom, ['description' => self::CUSTOM]]] as [$product, $extra]) {
            $quoteId = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
                $partnerId, array_merge(['product_id' => $product->id], $extra)
            ))->assertCreated()['data']['id'];
            $invoiceId = $this->withToken($this->auth['token'])->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
                ->assertCreated()['data']['id'];
            $this->withToken($this->auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk();
            $ids[] = $invoiceId;
        }

        $a = $this->fingerprint($ids[0], $plain->id);
        $b = $this->fingerprint($ids[1], $custom->id);
        $this->assertSame($a, $b);
        $this->assertSame(self::CUSTOM, Invoice::findOrFail($ids[1])->lines->first()->description);
        $this->assertSame('كرتون ورق A4', Invoice::findOrFail($ids[0])->lines->first()->description);

        // الأثر حقيقي لا فارغ — وإلا كانت المقارنة بلا معنى.
        $this->assertNotEmpty($b['stock']);
        $this->assertNotEmpty($b['journal']);
        $this->assertSame(7, $b['on_hand']);
    }

    /**
     * السطر اليدوي سلوكٌ قائم يبقى كما هو: بلا منتج، بلا حركة مخزون، ووصفه يُحفَظ كما كتبه المستخدم.
     *
     * @test
     */
    public function an_explicit_manual_line_stays_manual_and_creates_no_stock_movement(): void
    {
        $quoteId = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
            $this->partner(), ['description' => 'استشارة']
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'استشارة')['data']['id'];

        $invoiceId = $this->withToken($this->auth['token'])->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'استشارة')['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk();
        $this->assertSame(0, StockMovement::where('source_type', Invoice::class)->where('source_id', $invoiceId)->count());
    }

    /** @test */
    public function a_user_without_invoice_management_cannot_create_or_convert_a_quote_with_both_values(): void
    {
        $staff = $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@quote-line.test');
        $product = $this->product();
        $partnerId = $this->partner();
        $quoteId = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
            $partnerId, ['product_id' => $product->id, 'description' => 'قبل']
        ))->assertCreated()['data']['id'];

        $this->withToken($staff)->postJson('/api/quotes', $this->payload(
            $partnerId, ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertForbidden();
        $this->withToken($staff)->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])->assertForbidden();

        $this->withToken($this->auth['token'])->getJson("/api/quotes/{$quoteId}")
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.lines.0.description', 'قبل');
        $this->assertSame(0, Invoice::where('tenant_id', $this->auth['tenant_id'])->count());
    }

    /** @test */
    public function another_tenant_can_neither_read_convert_nor_link_the_product(): void
    {
        $product = $this->product();
        $quoteId = $this->withToken($this->auth['token'])->postJson('/api/quotes', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $other = $this->registerTenant('beta', 'owner@beta.test');
        $otherPartner = $this->partner($other['token']);

        $this->withToken($other['token'])->getJson("/api/quotes/{$quoteId}")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])->assertNotFound();
        // منتج مستأجر آخر لا يُربط بسطر عرض — حتى مع وصفٍ صالح.
        $this->withToken($other['token'])->postJson('/api/quotes', $this->payload(
            $otherPartner, ['product_id' => $product->id, 'description' => 'تسلل']
        ))->assertStatus(422);

        // لم يتغيّر شيء عند المالك: العرض على حاله، ولا فاتورة ولا قيد.
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $quote = Quote::findOrFail($quoteId);
        $this->assertSame('draft', $quote->status);
        $this->assertSame(self::CUSTOM, $quote->lines->first()->description);
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->count());
    }
}

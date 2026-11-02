<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * وصف السطر المخصَّص و`product_id` قيمتان متوازيتان لا تُلغي إحداهما الأخرى.
 *
 * كان معالج الوصف في شاشة الفاتورة يمسح `product_id` مع كل ضغطة مفتاح فيُرسَل
 * السطر بلا منتج ويفلت من المخزون والتكلفة. الإصلاح في الواجهة؛ وهذا الاختبار
 * يثبّت عقد الخلفية الذي يعتمد عليه: الحمولة التي فيها الاثنان معاً تُقبل وتُحفَظ
 * وتُرحَّل وتُقرأ كما هي، دون أن يتغيّر مال ولا مخزون ولا قيد.
 *
 * تشغيل:  php artisan test --filter=InvoiceLineDescriptionProductLinkTest
 */
class InvoiceLineDescriptionProductLinkTest extends TestCase
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
            'name' => 'عميل الوصف', 'type' => 'customer',
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
            'partner_id' => $partnerId, 'payment_type' => 'credit',
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
    public function a_draft_saves_both_the_product_and_the_customized_description_and_returns_them_on_reload(): void
    {
        $product = $this->product();
        $created = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson('/api/invoices/'.$created['data']['id'])->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)
            // لقطة الهوية تبقى اسمَ المنتج؛ الوصف لا يطمسها ولا تطمسه.
            ->assertJsonPath('data.lines.0.product_name', 'كرتون ورق A4');
    }

    /** @test */
    public function editing_a_draft_keeps_the_product_link_and_stores_the_new_description(): void
    {
        $product = $this->product();
        $partnerId = $this->partner();
        $id = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $partnerId, ['product_id' => $product->id, 'description' => 'وصف أول']
        ))->assertCreated()['data']['id'];

        $this->withToken($this->auth['token'])->putJson("/api/invoices/{$id}", $this->payload(
            $partnerId, ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$id}")->assertOk()
            ->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
    }

    /** @test */
    public function posting_preserves_both_values_and_the_response_after_posting_still_shows_them(): void
    {
        $product = $this->product();
        $id = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$id}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$id}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)
            ->assertJsonPath('data.lines.0.product_name', 'كرتون ورق A4');

        $this->assertDatabaseHas('invoice_lines', [
            'invoice_id' => $id, 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);
    }

    /** @test */
    public function a_custom_description_changes_no_money_vat_inventory_or_journal_entry(): void
    {
        $plain = $this->product('P-PLAIN');
        $custom = $this->product('P-CUSTOM');
        $partnerId = $this->partner();

        $plainId = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $partnerId, ['product_id' => $plain->id, 'discount' => 500]
        ))->assertCreated()['data']['id'];
        $customId = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $partnerId, ['product_id' => $custom->id, 'discount' => 500, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];
        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$plainId}/post")->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$customId}/post")->assertOk();

        $a = $this->fingerprint($plainId, $plain->id);
        $b = $this->fingerprint($customId, $custom->id);

        $this->assertSame($a, $b);
        // الفاتورة العادية تحتفظ باسم المنتج وصفاً افتراضياً؛ المخصّصة تحمل وصفها.
        $this->assertSame('كرتون ورق A4', Invoice::findOrFail($plainId)->lines->first()->description);
        $this->assertSame(self::CUSTOM, Invoice::findOrFail($customId)->lines->first()->description);
        // الأثر المخزوني والمحاسبي حقيقيان لا فارغان — وإلا كانت المقارنة بلا معنى.
        $this->assertNotEmpty($b['stock']);
        $this->assertNotEmpty($b['journal']);
        $this->assertSame(7, $b['on_hand']);
    }

    /** @test */
    public function a_line_without_a_product_keeps_its_description_and_creates_no_stock_movement(): void
    {
        $id = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $this->partner(), ['description' => 'استشارة']
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'استشارة')['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$id}/post")->assertOk();

        $this->assertSame(0, StockMovement::where('source_type', Invoice::class)->where('source_id', $id)->count());
    }

    /** @test */
    public function an_untouched_historical_line_still_defaults_to_the_product_name_when_no_description_is_sent(): void
    {
        $product = $this->product();
        $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $this->partner(), ['product_id' => $product->id]
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', 'كرتون ورق A4');
    }

    /** @test */
    public function a_user_without_invoice_management_cannot_write_a_line_with_both_values(): void
    {
        $staff = $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@line-desc.test');
        $product = $this->product();
        $partnerId = $this->partner();
        $id = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $partnerId, ['product_id' => $product->id, 'description' => 'قبل']
        ))->assertCreated()['data']['id'];

        $body = $this->payload($partnerId, ['product_id' => $product->id, 'description' => self::CUSTOM]);
        $this->withToken($staff)->postJson('/api/invoices', $body)->assertForbidden();
        $this->withToken($staff)->putJson("/api/invoices/{$id}", $body)->assertForbidden();

        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$id}")
            ->assertJsonPath('data.lines.0.description', 'قبل');
    }

    /** @test */
    public function another_tenant_can_neither_read_the_invoice_nor_link_the_product(): void
    {
        $product = $this->product();
        $id = $this->withToken($this->auth['token'])->postJson('/api/invoices', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $other = $this->registerTenant('beta', 'owner@beta.test');
        $otherPartner = $this->partner($other['token']);

        $this->withToken($other['token'])->getJson("/api/invoices/{$id}")->assertNotFound();
        $this->withToken($other['token'])->putJson("/api/invoices/{$id}", $this->payload(
            $otherPartner, ['product_id' => $product->id, 'description' => 'تسلل']
        ))->assertNotFound();
        // منتج مستأجر آخر لا يُربط بسطر — حتى مع وصفٍ صالح.
        $this->withToken($other['token'])->postJson('/api/invoices', $this->payload(
            $otherPartner, ['product_id' => $product->id, 'description' => 'تسلل']
        ))->assertStatus(422);

        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->assertSame(self::CUSTOM, Invoice::findOrFail($id)->lines->first()->description);
    }
}

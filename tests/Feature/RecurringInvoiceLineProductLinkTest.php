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
 * وصف سطر القالب الدوري المخصَّص و`product_id` قيمتان متوازيتان لا تُلغي إحداهما الأخرى.
 *
 * كان معالج الوصف في شاشة القالب الدوري يمسح `product_id` مع كل ضغطة مفتاح، فيُحفَظ
 * القالب بسطرٍ بلا منتج، وتخرج منه كل فاتورة مولَّدة بلا منتج فلا يُخصم مخزون ولا
 * تُسجَّل تكلفة — وبلا تدخّل بشري في كل دورة. الإصلاح في الواجهة؛ وهذا الاختبار يثبّت
 * عقد الخلفية الذي يعتمد عليه: حفظ القالب ثم توليد الفاتورة ثم ترحيلها يحفظ القيمتين
 * معاً، دون أن يتغيّر مال ولا ضريبة ولا مخزون ولا قيد.
 *
 * تشغيل:  php artisan test --filter=RecurringInvoiceLineProductLinkTest
 */
class RecurringInvoiceLineProductLinkTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CUSTOM = 'اشتراك ورق A4 الشهري — مع التوصيل';

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
            'name' => 'عميل دوري', 'type' => 'customer',
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
            'partner_id' => $partnerId, 'frequency' => 'monthly', 'start_date' => '2026-06-01',
            'payment_type' => 'credit',
            'items' => [array_merge(['quantity' => 3, 'unit_price' => 9500, 'tax_rate' => 15], $line)],
        ];
    }

    private function template(array $line, ?string $token = null, ?string $partnerId = null): string
    {
        return $this->withToken($token ?? $this->auth['token'])->postJson(
            '/api/recurring-invoices', $this->payload($partnerId ?? $this->partner(), $line)
        )->assertCreated()['data']['id'];
    }

    private function generate(string $templateId): string
    {
        return $this->withToken($this->auth['token'])->postJson("/api/recurring-invoices/{$templateId}/generate")
            ->assertCreated()['data']['id'];
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
    public function saving_a_template_keeps_both_the_product_and_the_customized_description_on_reload(): void
    {
        $product = $this->product();
        $res = $this->withToken($this->auth['token'])->postJson('/api/recurring-invoices', $this->payload(
            $this->partner(), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson('/api/recurring-invoices/'.$res['data']['id'])->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
        $this->assertDatabaseHas('recurring_invoice_lines', [
            'recurring_invoice_id' => $res['data']['id'], 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);
    }

    /** @test */
    public function a_generated_draft_carries_both_values_and_stays_without_stock_or_journal_effect(): void
    {
        $product = $this->product();
        $templateId = $this->template(['product_id' => $product->id, 'description' => self::CUSTOM]);

        $invoiceId = $this->withToken($this->auth['token'])->postJson("/api/recurring-invoices/{$templateId}/generate")
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)['data']['id'];

        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$invoiceId}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM)
            // لقطة الهوية تبقى اسمَ المنتج؛ الوصف لا يطمسها ولا تطمسه.
            ->assertJsonPath('data.lines.0.product_name', 'كرتون ورق A4');

        // المسودة بلا قيد ولا حركة مخزون — كما هو قائم.
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoiceId)->count());
        $this->assertSame(0, StockMovement::where('source_type', Invoice::class)->where('source_id', $invoiceId)->count());
        $this->assertSame(10, (int) Product::findOrFail($product->id)->quantity_on_hand);
    }

    /** @test */
    public function posting_the_generated_invoice_preserves_both_values_and_follows_the_normal_stock_rules(): void
    {
        $product = $this->product();
        $invoiceId = $this->generate($this->template(['product_id' => $product->id, 'description' => self::CUSTOM]));

        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson("/api/invoices/{$invoiceId}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
        $this->assertDatabaseHas('invoice_lines', [
            'invoice_id' => $invoiceId, 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);
        // الربط هو ما يُفعّل المخزون والتكلفة عند الترحيل — بلا ربط كانتا تسقطان.
        $this->assertNotEmpty(StockMovement::where('source_type', Invoice::class)->where('source_id', $invoiceId)->get());
        $this->assertSame(7, (int) Product::findOrFail($product->id)->quantity_on_hand);
        $this->assertGreaterThan(0, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoiceId)->count());
    }

    /** @test */
    public function a_custom_description_changes_no_money_vat_inventory_or_journal_entry(): void
    {
        $plain = $this->product('P-PLAIN');
        $custom = $this->product('P-CUSTOM');
        $partnerId = $this->partner();

        $plainInvoice = $this->generate($this->template(['product_id' => $plain->id], null, $partnerId));
        $customInvoice = $this->generate($this->template(
            ['product_id' => $custom->id, 'description' => self::CUSTOM], null, $partnerId
        ));
        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$plainInvoice}/post")->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$customInvoice}/post")->assertOk();

        $a = $this->fingerprint($plainInvoice, $plain->id);
        $b = $this->fingerprint($customInvoice, $custom->id);
        $this->assertSame($a, $b);
        $this->assertSame(self::CUSTOM, Invoice::findOrFail($customInvoice)->lines->first()->description);

        // الأثر المخزوني والمحاسبي حقيقيان لا فارغان — وإلا كانت المقارنة بلا معنى.
        $this->assertNotEmpty($b['stock']);
        $this->assertNotEmpty($b['journal']);
        $this->assertSame(7, $b['on_hand']);
    }

    /** @test */
    public function every_cycle_keeps_the_link_so_each_generated_invoice_moves_stock(): void
    {
        $product = $this->product();
        $templateId = $this->template(['product_id' => $product->id, 'description' => self::CUSTOM, 'quantity' => 2]);

        foreach ([1, 2] as $cycle) {
            $invoiceId = $this->generate($templateId);
            $this->withToken($this->auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk()
                ->assertJsonPath('data.lines.0.product_id', $product->id)
                ->assertJsonPath('data.lines.0.description', self::CUSTOM);
            $this->assertSame(10 - 2 * $cycle, (int) Product::findOrFail($product->id)->quantity_on_hand);
        }
    }

    /** @test */
    public function a_manual_line_without_a_product_stays_manual_and_moves_no_stock(): void
    {
        $templateId = $this->template(['description' => 'خدمة استشارية شهرية']);

        $this->withToken($this->auth['token'])->getJson("/api/recurring-invoices/{$templateId}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'خدمة استشارية شهرية');

        $invoiceId = $this->generate($templateId);
        $this->withToken($this->auth['token'])->postJson("/api/invoices/{$invoiceId}/post")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'خدمة استشارية شهرية');
        $this->assertSame(0, StockMovement::where('source_type', Invoice::class)->where('source_id', $invoiceId)->count());
    }

    /** @test */
    public function an_untouched_template_line_without_a_description_still_defaults_to_the_product_name(): void
    {
        $product = $this->product();
        $templateId = $this->template(['product_id' => $product->id]);

        $this->withToken($this->auth['token'])->getJson("/api/recurring-invoices/{$templateId}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id);

        $this->withToken($this->auth['token'])->postJson("/api/recurring-invoices/{$templateId}/generate")
            ->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', 'كرتون ورق A4');
    }

    /** @test */
    public function a_user_without_invoice_management_cannot_save_or_generate_a_template_with_both_values(): void
    {
        $staff = $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@recurring-line.test');
        $product = $this->product();
        $partnerId = $this->partner();
        $templateId = $this->template(['product_id' => $product->id, 'description' => 'قبل'], null, $partnerId);

        $this->withToken($staff)->postJson('/api/recurring-invoices', $this->payload(
            $partnerId, ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertForbidden();
        $this->withToken($staff)->postJson("/api/recurring-invoices/{$templateId}/generate")->assertForbidden();

        $this->withToken($this->auth['token'])->getJson("/api/recurring-invoices/{$templateId}")
            ->assertJsonPath('data.lines.0.description', 'قبل')
            ->assertJsonPath('data.generated_count', 0);
    }

    /** @test */
    public function another_tenant_can_neither_read_generate_nor_link_the_product(): void
    {
        $product = $this->product();
        $templateId = $this->template(['product_id' => $product->id, 'description' => self::CUSTOM]);

        $other = $this->registerTenant('beta', 'owner@beta.test');
        $otherPartner = $this->partner($other['token']);

        $this->withToken($other['token'])->getJson("/api/recurring-invoices/{$templateId}")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/recurring-invoices/{$templateId}/generate")->assertNotFound();
        // منتج مستأجر آخر لا يُربط بسطر قالب — حتى مع وصفٍ صالح.
        $this->withToken($other['token'])->postJson('/api/recurring-invoices', $this->payload(
            $otherPartner, ['product_id' => $product->id, 'description' => 'تسلل']
        ))->assertStatus(422);

        // لم يتغيّر شيء عند المالك: العدّاد صفر والوصف والمنتج كما حُفظا.
        $this->assertDatabaseHas('recurring_invoices', ['id' => $templateId, 'generated_count' => 0]);
        $this->assertDatabaseHas('recurring_invoice_lines', [
            'recurring_invoice_id' => $templateId, 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);
    }
}

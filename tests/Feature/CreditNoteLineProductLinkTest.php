<?php
namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * وصف السطر المخصَّص و`product_id` قيمتان متوازيتان في الإشعار المستقل (دائن ومدين).
 *
 * الإصلاح في نموذج الواجهة (`credit-note-form.tsx`)؛ وهذه الاختبارات تثبّت عقد الخلفية:
 * الحمولة التي فيها الاثنان معاً تُحفَظ وتُسترجَع وتُرحَّل دون أن يتغيّر مال أو ضريبة أو
 * قيد. الإشعار المدين لا يمسّ المخزون (كما في DebitNoteTest)، والدائن المستقل لا يُنشئ
 * حركة مخزون عند الترحيل — هذا سلوك قائم لا يُغيَّر هنا.
 *
 * تشغيل:  php artisan test --filter=CreditNoteLineProductLinkTest
 */
class CreditNoteLineProductLinkTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const CUSTOM = 'كرتون ورق A4 — مع التوصيل';

    private array $auth;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant();
        $this->allowStandaloneCreditNotes($this->auth['tenant_id']);
        app(TenantContext::class)->set($this->auth['tenant_id']);
    }

    private function partner(string $type, ?string $token = null): string
    {
        return $this->withToken($token ?? $this->auth['token'])->postJson('/api/partners', [
            'name' => $type === 'supplier' ? 'مورد الإشعار' : 'عميل الإشعار', 'type' => $type,
        ])->assertCreated()['data']['id'];
    }

    private function product(string $sku = 'A4-1', string $name = 'كرتون ورق A4'): Product
    {
        $product = Product::create([
            'tenant_id' => $this->auth['tenant_id'], 'name' => $name, 'sku' => $sku,
            'type' => 'good', 'track_inventory' => true, 'sale_price' => 9500, 'tax_rate' => 15,
        ]);
        $warehouse = Warehouse::first() ?? Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        app(InventoryService::class)->receiveStock($product, 10, 4000, ['warehouse_id' => $warehouse->id]);

        return $product->fresh();
    }

    private function payload(string $type, string $partnerId, array $line): array
    {
        return [
            'partner_id' => $partnerId, 'type' => $type, 'refund_type' => 'credit',
            'items' => [array_merge(['quantity' => 3, 'unit_price' => 9500, 'tax_rate' => 15], $line)],
        ];
    }

    /** بصمة مالية لا تتضمن المعرّفات ولا النصوص — لمقارنة إشعارين متكافئين. */
    private function fingerprint(string $noteId): array
    {
        $note = CreditNote::with('lines')->findOrFail($noteId);
        $journal = JournalEntry::with('lines.account')
            ->where('source_type', CreditNote::class)->where('source_id', $noteId)->get()
            ->flatMap(fn (JournalEntry $e) => $e->lines->map(
                fn ($l) => $l->account->code.':'.$l->debit.':'.$l->credit
            ))->sort()->values()->all();

        return [
            'totals' => [$note->subtotal, $note->tax_amount, $note->total],
            'line' => $note->lines->map(fn ($l) => [
                $l->quantity, $l->unit_price, $l->tax_rate, $l->line_subtotal, $l->line_tax, $l->line_total,
            ])->all(),
            'journal' => $journal,
        ];
    }

    private function noteStockMovements(string $noteId): int
    {
        return StockMovement::where('source_type', CreditNote::class)->where('source_id', $noteId)->count();
    }

    /** @test */
    public function a_standalone_sales_credit_note_keeps_both_the_product_and_the_custom_description_on_save_and_reload(): void
    {
        $product = $this->product();
        $created = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
            'sales', $this->partner('customer'), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson('/api/credit-notes/'.$created['data']['id'])->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
    }

    /** @test */
    public function a_standalone_debit_note_keeps_both_the_product_and_the_custom_description_on_save_and_reload(): void
    {
        $product = $this->product();
        $created = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
            'purchase', $this->partner('supplier'), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()
            ->assertJsonPath('data.type', 'purchase')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson('/api/credit-notes/'.$created['data']['id'])->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);
    }

    /** @test */
    public function posting_a_standalone_sales_credit_note_preserves_both_values(): void
    {
        $product = $this->product();
        $id = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
            'sales', $this->partner('customer'), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->assertDatabaseHas('credit_note_lines', [
            'credit_note_id' => $id, 'product_id' => $product->id, 'description' => self::CUSTOM,
        ]);
        $this->assertNotEmpty(JournalEntry::where('source_type', CreditNote::class)->where('source_id', $id)->get());
    }

    /**
     * الإشعار المدين: الوصف المخصص والمنتج يُحفظان ويُرحَّلان، والمخزون لا يتحرّك — كما في DebitNoteTest.
     *
     * @test
     */
    public function posting_a_debit_note_preserves_both_values_and_never_touches_inventory(): void
    {
        $product = $this->product();
        $before = (int) Product::findOrFail($product->id)->quantity_on_hand;
        $id = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
            'purchase', $this->partner('supplier'), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->withToken($this->auth['token'])->getJson("/api/credit-notes/{$id}")->assertOk()
            ->assertJsonPath('data.lines.0.product_id', $product->id)
            ->assertJsonPath('data.lines.0.description', self::CUSTOM);

        $this->assertSame($before, (int) Product::findOrFail($product->id)->quantity_on_hand);
        $this->assertSame(0, $this->noteStockMovements($id));
    }

    /**
     * الوصف المخصّص لا يغيّر مالاً ولا ضريبة ولا قيداً: إشعاران متطابقان، أحدهما بوصف مخصّص.
     *
     * @test
     */
    public function a_custom_description_changes_no_money_vat_or_journal_entry_on_either_note_type(): void
    {
        $plain = $this->product('P-PLAIN');
        $custom = $this->product('P-CUSTOM');

        foreach (['sales' => 'customer', 'purchase' => 'supplier'] as $type => $partnerType) {
            $partnerId = $this->partner($partnerType);
            $plainId = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
                $type, $partnerId, ['product_id' => $plain->id]
            ))->assertCreated()['data']['id'];
            $customId = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
                $type, $partnerId, ['product_id' => $custom->id, 'description' => self::CUSTOM]
            ))->assertCreated()['data']['id'];

            $this->withToken($this->auth['token'])->postJson("/api/credit-notes/{$plainId}/post")->assertOk();
            $this->withToken($this->auth['token'])->postJson("/api/credit-notes/{$customId}/post")->assertOk();

            $this->assertSame($this->fingerprint($plainId), $this->fingerprint($customId), "نوع {$type}");
            $this->assertNotEmpty($this->fingerprint($customId)['journal'], "نوع {$type}");
        }
    }

    /**
     * السطر اليدوي الصريح يبقى يدوياً: بلا منتج، ووصفه يُحفَظ كما كتبه المستخدم.
     *
     * @test
     */
    public function an_explicit_manual_line_on_a_standalone_note_stays_manual(): void
    {
        $id = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
            'sales', $this->partner('customer'), ['description' => 'تعويض خدمة']
        ))->assertCreated()
            ->assertJsonPath('data.lines.0.product_id', null)
            ->assertJsonPath('data.lines.0.description', 'تعويض خدمة')['data']['id'];

        $this->withToken($this->auth['token'])->postJson("/api/credit-notes/{$id}/post")->assertOk();
        $this->assertSame(0, $this->noteStockMovements($id));
    }

    /** @test */
    public function a_user_without_invoice_management_cannot_create_either_note_type_with_both_values(): void
    {
        $staff = $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@cn-line.test');
        $product = $this->product();
        // المعرّفات تُحسب أولاً: استدعاء partner() بعد withToken() يستبدل التوكن بتوكن المالك.
        $customerId = $this->partner('customer');
        $supplierId = $this->partner('supplier');
        $salesBody = $this->payload('sales', $customerId, ['product_id' => $product->id, 'description' => self::CUSTOM]);
        $purchaseBody = $this->payload('purchase', $supplierId, ['product_id' => $product->id, 'description' => self::CUSTOM]);

        $this->withToken($staff)->postJson('/api/credit-notes', $salesBody)->assertForbidden();
        $this->withToken($staff)->postJson('/api/credit-notes', $purchaseBody)->assertForbidden();

        $this->assertSame(0, CreditNote::where('tenant_id', $this->auth['tenant_id'])->count());
    }

    /** @test */
    public function another_tenant_can_neither_read_the_note_nor_link_this_tenants_product(): void
    {
        $product = $this->product();
        $id = $this->withToken($this->auth['token'])->postJson('/api/credit-notes', $this->payload(
            'sales', $this->partner('customer'), ['product_id' => $product->id, 'description' => self::CUSTOM]
        ))->assertCreated()['data']['id'];

        $other = $this->registerTenant('beta', 'owner@beta.test');
        $this->allowStandaloneCreditNotes($other['tenant_id']);
        $otherPartner = $this->partner('customer', $other['token']);

        $this->withToken($other['token'])->getJson("/api/credit-notes/{$id}")->assertNotFound();
        $this->withToken($other['token'])->postJson("/api/credit-notes/{$id}/post")->assertNotFound();
        $this->withToken($other['token'])->postJson('/api/credit-notes', $this->payload(
            'sales', $otherPartner, ['product_id' => $product->id, 'description' => 'تسلل']
        ))->assertStatus(422);

        app(TenantContext::class)->set($this->auth['tenant_id']);
        $note = CreditNote::findOrFail($id);
        $this->assertSame('draft', $note->status);
        $this->assertSame(self::CUSTOM, $note->lines->first()->description);
    }
}

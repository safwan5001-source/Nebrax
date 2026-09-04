<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\PosExchange;
use App\Models\PosExchangeAttempt;
use App\Models\PosReturnAttempt;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\StockMovement;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * R4: idempotency durable لمرتجع POS واستبدال POS. معيار النجاح:
 *
 *   عملية منطقية واحدة (مفتاح واحد) = أثر مالي/مخزني ملتزم واحد على الأكثر —
 *   نفس المفتاح والحمولة يعيد النتيجة الأصلية، ونفس المفتاح بحمولة مختلفة يتعارض.
 */
class PosReturnExchangeIdempotencyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @return array{session_id:string,warehouse_id:string} */
    private function openSession(array $auth): array
    {
        $n = ++$this->sequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن إتمام مرتجع {$n}", 'code' => "POS-RI-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير إتمام مرتجع {$n}", 'code' => "POS-RI-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];

        return ['session_id' => $sessionId, 'warehouse_id' => $warehouseId];
    }

    private function customer(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل إتمام مرتجع', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** بيع منتج مثبت — لا سطر وصفي: مرتجع POS يرفض سطراً بلا منتج (`buildSourceItems`). */
    private function checkout(array $auth, string $partnerId, string $sessionId, int $unitPrice = 10000): Invoice
    {
        $product = Product::create([
            'name' => 'صنف إتمام مرتجع ' . Str::random(6), 'sale_price' => $unitPrice,
            'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);
        $response = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            'tenders' => ['cash' => (int) round($unitPrice * 1.15)],
        ])->assertCreated();

        return Invoice::with('lines')->findOrFail($response['data']['id']);
    }

    private function returnPayload(string $sessionId, Invoice $invoice, string $key, int $quantity = 1): array
    {
        return [
            'idempotency_key' => $key,
            'pos_session_id' => $sessionId,
            'original_invoice_id' => $invoice->id,
            'payment_type' => 'cash',
            'items' => [[
                'source_line_id' => $invoice->lines->firstOrFail()->id,
                'quantity' => $quantity,
            ]],
        ];
    }

    private function exchangePayload(
        array $auth,
        string $sessionId,
        Invoice $invoice,
        string $key,
        int $replacementPrice = 10000,
    ): array {
        $replacement = Product::create([
            'name' => 'صنف بديل ' . Str::random(6), 'sale_price' => $replacementPrice,
            'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);

        return [
            'idempotency_key' => $key,
            'pos_session_id' => $sessionId,
            'original_invoice_id' => $invoice->id,
            'return_items' => [[
                'source_line_id' => $invoice->lines->firstOrFail()->id,
                'quantity' => 1,
            ]],
            'surplus_refund_method' => 'credit',
            'replacement' => [
                'items' => [['product_id' => $replacement->id, 'quantity' => 1, 'unit_price' => $replacementPrice, 'tax_rate' => 15]],
                'tenders' => ['cash' => 0],
            ],
        ];
    }

    // ─────────────────────────────────────────── مرتجع POS ───────────────────────────────────────────

    /** @test */
    public function return_replays_the_same_document_for_the_same_key_and_payload(): void
    {
        $auth = $this->registerTenant('pos-return-idem-replay', 'owner@pos-return-idem-replay.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);
        $key = (string) Str::uuid();
        $payload = $this->returnPayload($session['session_id'], $invoice, $key);

        $first = $this->withToken($auth['token'])->postJson('/api/pos/returns', $payload)->assertCreated();
        $returnId = $first['data']['id'];

        $second = $this->withToken($auth['token'])->postJson('/api/pos/returns', $payload)
            ->assertOk()
            ->assertJsonPath('data.id', $returnId)
            ->assertJsonPath('idempotent_replay', true);

        $this->assertSame($returnId, $second['data']['id']);
        $this->assertSame(1, ReturnDocument::count());
        $this->assertSame(1, PosReturnAttempt::count());
        $this->assertSame(1, JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $returnId)->count());
    }

    /** @test */
    public function return_conflicts_when_the_same_key_carries_a_different_payload(): void
    {
        $auth = $this->registerTenant('pos-return-idem-conflict', 'owner@pos-return-idem-conflict.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        // فاتورتان بكميتين تسمحان بردّ سطر واحد لكل منهما، فيختلف source_line_id
        // بين الطلبين رغم مفتاح idempotency نفسه — تعارض منطقي حقيقي لا خطأ حدود.
        $invoiceA = $this->checkout($auth, $partnerId, $session['session_id']);
        $invoiceB = $this->checkout($auth, $partnerId, $session['session_id']);
        $key = (string) Str::uuid();

        $this->withToken($auth['token'])->postJson('/api/pos/returns', $this->returnPayload($session['session_id'], $invoiceA, $key))
            ->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/pos/returns', $this->returnPayload($session['session_id'], $invoiceB, $key))
            ->assertStatus(409);

        $this->assertSame(1, ReturnDocument::count());
        $this->assertSame(1, PosReturnAttempt::count());
    }

    /** @test */
    public function a_different_return_key_creates_a_new_document(): void
    {
        $auth = $this->registerTenant('pos-return-idem-new', 'owner@pos-return-idem-new.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoiceA = $this->checkout($auth, $partnerId, $session['session_id']);
        $invoiceB = $this->checkout($auth, $partnerId, $session['session_id']);

        $this->withToken($auth['token'])->postJson('/api/pos/returns', $this->returnPayload($session['session_id'], $invoiceA, (string) Str::uuid()))
            ->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/pos/returns', $this->returnPayload($session['session_id'], $invoiceB, (string) Str::uuid()))
            ->assertCreated();

        $this->assertSame(2, ReturnDocument::count());
        $this->assertSame(2, PosReturnAttempt::count());
    }

    /** @test */
    public function the_same_return_key_is_isolated_across_tenants(): void
    {
        $authA = $this->registerTenant('pos-return-idem-t1', 'owner@pos-return-idem-t1.test');
        $authB = $this->registerTenant('pos-return-idem-t2', 'owner@pos-return-idem-t2.test');
        $key = (string) Str::uuid();

        app(TenantContext::class)->set($authA['tenant_id']);
        $sessionA = $this->openSession($authA);
        $partnerA = $this->customer($authA['token']);
        $invoiceA = $this->checkout($authA, $partnerA, $sessionA['session_id']);
        $returnA = $this->withToken($authA['token'])->postJson('/api/pos/returns', $this->returnPayload($sessionA['session_id'], $invoiceA, $key))
            ->assertCreated()['data']['id'];

        app(TenantContext::class)->set($authB['tenant_id']);
        $sessionB = $this->openSession($authB);
        $partnerB = $this->customer($authB['token']);
        $invoiceB = $this->checkout($authB, $partnerB, $sessionB['session_id']);
        $returnB = $this->withToken($authB['token'])->postJson('/api/pos/returns', $this->returnPayload($sessionB['session_id'], $invoiceB, $key))
            ->assertCreated()['data']['id'];

        $this->assertNotSame($returnA, $returnB);
        $this->assertSame(2, PosReturnAttempt::withoutGlobalScopes()->count());
    }

    /** @test */
    public function return_replay_does_not_duplicate_inventory_or_journal_effects(): void
    {
        $auth = $this->registerTenant('pos-return-idem-stock', 'owner@pos-return-idem-stock.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $product = Product::create([
            'name' => 'صنف إتمام مرتجع', 'sale_price' => 10000,
            'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);
        app(\App\Services\Accounting\InventoryService::class)->applyReceipt($product, 20, 5000, ['warehouse_id' => $session['warehouse_id']]);

        $invoiceResponse = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $session['session_id'],
            'items' => [['product_id' => $product->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 11500],
        ])->assertCreated();
        $invoice = Invoice::with('lines')->findOrFail($invoiceResponse['data']['id']);
        $key = (string) Str::uuid();
        $payload = $this->returnPayload($session['session_id'], $invoice, $key);

        $first = $this->withToken($auth['token'])->postJson('/api/pos/returns', $payload)->assertCreated()['data'];
        $balanceAfterFirst = $product->fresh()->quantity_on_hand;
        $stockMovementsAfterFirst = StockMovement::where('source_type', ReturnDocument::class)->where('source_id', $first['id'])->count();
        $journalAfterFirst = JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $first['id'])->count();

        $this->withToken($auth['token'])->postJson('/api/pos/returns', $payload)->assertOk();

        $this->assertSame($balanceAfterFirst, $product->fresh()->quantity_on_hand, 'الرصيد لا يتغيّر عند إعادة تشغيل مفتاح إتمام مستخدم.');
        $this->assertSame(
            $stockMovementsAfterFirst,
            StockMovement::where('source_type', ReturnDocument::class)->where('source_id', $first['id'])->count(),
        );
        $this->assertSame(
            $journalAfterFirst,
            JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $first['id'])->count(),
        );
        $this->assertSame(1, ReturnDocument::count());
    }

    /** @test */
    public function return_requires_an_idempotency_key(): void
    {
        $auth = $this->registerTenant('pos-return-idem-required', 'owner@pos-return-idem-required.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);

        $payload = $this->returnPayload($session['session_id'], $invoice, (string) Str::uuid());
        unset($payload['idempotency_key']);

        $this->withToken($auth['token'])->postJson('/api/pos/returns', $payload)
            ->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
        $this->assertSame(0, ReturnDocument::count());
    }

    // ─────────────────────────────────────────── استبدال POS ───────────────────────────────────────────

    /** @test */
    public function exchange_replays_the_same_documents_for_the_same_key_and_payload(): void
    {
        $auth = $this->registerTenant('pos-exchange-idem-replay', 'owner@pos-exchange-idem-replay.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);
        $key = (string) Str::uuid();
        $payload = $this->exchangePayload($auth, $session['session_id'], $invoice, $key);

        $first = $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $payload)->assertCreated();
        $exchangeId = $first['data']['id'];

        $second = $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $payload)
            ->assertOk()
            ->assertJsonPath('data.id', $exchangeId)
            ->assertJsonPath('idempotent_replay', true);

        $this->assertSame($exchangeId, $second['data']['id']);
        $this->assertSame(1, PosExchange::count());
        $this->assertSame(1, ReturnDocument::count());
        $this->assertSame(2, Invoice::count()); // الأصلية + البديل فقط، لا بديل ثانٍ.
        $this->assertSame(1, PosExchangeAttempt::count());
    }

    /** @test */
    public function exchange_conflicts_when_the_same_key_carries_a_different_payload(): void
    {
        $auth = $this->registerTenant('pos-exchange-idem-conflict', 'owner@pos-exchange-idem-conflict.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);
        $key = (string) Str::uuid();

        $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $this->exchangePayload($auth, $session['session_id'], $invoice, $key, 10000))
            ->assertCreated();

        // نفس المفتاح، بديل بسعر مختلف — حمولة منطقية مختلفة.
        $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $this->exchangePayload($auth, $session['session_id'], $invoice, $key, 20000))
            ->assertStatus(409);

        $this->assertSame(1, PosExchange::count());
        $this->assertSame(1, PosExchangeAttempt::count());
    }

    /** @test */
    public function a_different_exchange_key_creates_a_new_exchange(): void
    {
        $auth = $this->registerTenant('pos-exchange-idem-new', 'owner@pos-exchange-idem-new.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoiceA = $this->checkout($auth, $partnerId, $session['session_id']);
        $invoiceB = $this->checkout($auth, $partnerId, $session['session_id']);

        $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $this->exchangePayload($auth, $session['session_id'], $invoiceA, (string) Str::uuid()))
            ->assertCreated();
        $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $this->exchangePayload($auth, $session['session_id'], $invoiceB, (string) Str::uuid()))
            ->assertCreated();

        $this->assertSame(2, PosExchange::count());
        $this->assertSame(2, PosExchangeAttempt::count());
    }

    /** @test */
    public function the_same_exchange_key_is_isolated_across_tenants(): void
    {
        $authA = $this->registerTenant('pos-exchange-idem-t1', 'owner@pos-exchange-idem-t1.test');
        $authB = $this->registerTenant('pos-exchange-idem-t2', 'owner@pos-exchange-idem-t2.test');
        $key = (string) Str::uuid();

        app(TenantContext::class)->set($authA['tenant_id']);
        $sessionA = $this->openSession($authA);
        $partnerA = $this->customer($authA['token']);
        $invoiceA = $this->checkout($authA, $partnerA, $sessionA['session_id']);
        $exchangeA = $this->withToken($authA['token'])->postJson('/api/pos/exchanges', $this->exchangePayload($authA, $sessionA['session_id'], $invoiceA, $key))
            ->assertCreated()['data']['id'];

        app(TenantContext::class)->set($authB['tenant_id']);
        $sessionB = $this->openSession($authB);
        $partnerB = $this->customer($authB['token']);
        $invoiceB = $this->checkout($authB, $partnerB, $sessionB['session_id']);
        $exchangeB = $this->withToken($authB['token'])->postJson('/api/pos/exchanges', $this->exchangePayload($authB, $sessionB['session_id'], $invoiceB, $key))
            ->assertCreated()['data']['id'];

        $this->assertNotSame($exchangeA, $exchangeB);
        $this->assertSame(2, PosExchangeAttempt::withoutGlobalScopes()->count());
    }

    /** @test */
    public function exchange_replay_does_not_duplicate_inventory_or_journal_or_refund_effects(): void
    {
        $auth = $this->registerTenant('pos-exchange-idem-stock', 'owner@pos-exchange-idem-stock.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);
        $key = (string) Str::uuid();
        $payload = $this->exchangePayload($auth, $session['session_id'], $invoice, $key);

        $first = $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $payload)->assertCreated()['data'];
        $exchange = PosExchange::findOrFail($first['id']);
        $journalCountAfterFirst = JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $exchange->return_id)->count()
            + JournalEntry::where('source_type', Invoice::class)->where('source_id', $exchange->replacement_invoice_id)->count();

        $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $payload)->assertOk();

        $this->assertSame(1, PosExchange::count());
        $this->assertSame(1, ReturnDocument::count());
        $this->assertSame(2, Invoice::count());
        $this->assertSame(
            $journalCountAfterFirst,
            JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $exchange->return_id)->count()
                + JournalEntry::where('source_type', Invoice::class)->where('source_id', $exchange->replacement_invoice_id)->count(),
        );
    }

    /** @test */
    public function exchange_requires_an_idempotency_key(): void
    {
        $auth = $this->registerTenant('pos-exchange-idem-required', 'owner@pos-exchange-idem-required.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);

        $payload = $this->exchangePayload($auth, $session['session_id'], $invoice, (string) Str::uuid());
        unset($payload['idempotency_key']);

        $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $payload)
            ->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
        $this->assertSame(0, PosExchange::count());
    }

    // ─────────────────────────────────────────── حماية التزامن (مستوى القاعدة) ───────────────────────────────────────────

    /**
     * R4 §15 — التزامن الحقيقي (طلبان متوازيان فعلياً بنفس المفتاح) غير قابل
     * للمحاكاة بموثوقية داخل عملية PHPUnit أحادية الاتصال بـ SQLite/PostgreSQL؛
     * محاكاة "نافذتين متزامنتين" هنا كانتا ستنفّذان تسلسلياً فتصبحان نفس
     * اختبار "نفس المفتاح مرتين" أعلاه بلا قيمة إضافية.
     *
     * البديل الموثوق: إثبات أن القيد الفريد الذي يحمي المسار عند التزامن
     * الحقيقي (catch(QueryException) في PosReturnService/PosExchangeService)
     * موجود فعلاً على مستوى القاعدة — فصفّان بنفس (tenant_id, branch_id,
     * idempotency_key) لا يمكن أن يُلتزَما معاً مهما كان ترتيب المعاملتين.
     */
    /** @test */
    public function the_database_rejects_a_second_return_attempt_row_for_the_same_tenant_branch_and_key(): void
    {
        $auth = $this->registerTenant('pos-return-idem-race', 'owner@pos-return-idem-race.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoiceA = $this->checkout($auth, $partnerId, $session['session_id']);
        $invoiceB = $this->checkout($auth, $partnerId, $session['session_id']);
        $key = (string) Str::uuid();

        $returnA = $this->withToken($auth['token'])->postJson('/api/pos/returns', $this->returnPayload($session['session_id'], $invoiceA, $key))
            ->assertCreated()['data']['id'];
        $returnB = $this->withToken($auth['token'])->postJson('/api/pos/returns', $this->returnPayload($session['session_id'], $invoiceB, (string) Str::uuid()))
            ->assertCreated()['data']['id'];

        $branchId = app(BranchContext::class)->id();
        $this->expectException(QueryException::class);
        PosReturnAttempt::withWriting(fn () => PosReturnAttempt::create([
            'idempotency_key' => $key,
            'request_checksum' => str_repeat('a', 64),
            'return_id' => $returnB,
            'pos_session_id' => $session['session_id'],
            'created_by' => null,
            'created_at' => now(),
        ]));
    }
}

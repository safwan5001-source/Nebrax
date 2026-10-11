<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PosReturnService;
use App\Services\Accounting\ReturnService;
use App\Services\Reporting\ReturnVatDiscrepancyReport;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use ReflectionMethod;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-01 — مرتجعات POS وAPI المتداخلة على الفاتورة نفسها
 * ═══════════════════════════════════════════════════════════════
 *  مرتجعات POS تقرّب كل جزءٍ لأسفل بمعزل عن سابقه وتُسند الباقي لآخر جزء؛
 *  ومرتجعات الـAPI توزّع بنصيب تراكمي F(c+q) − F(c). فبعد أجزاء POS جزئية
 *  كان آخر مرتجعٍ من الـAPI يترك 1–7 هللات (ضريبة وصافياً) بلا إمكان ردّ.
 *  الإصلاح: الجزء الأخير بسعر كامل يأخذ **المتبقي الفعلي**، إلا إن سبق ردٌّ
 *  بسعر مخفَّض فيبقى الفرق المحتجَز محتجَزاً.
 *
 *  الثابت المحاسبي المُثبَت هنا: بعد ردّ كل الكميات بقيمتها الأصلية يساوي Σ
 *  المرتجعات (صافي، ضريبة، إجمالي) الفاتورةَ هللةً بهللة، ويتصفّر 2120 و4110،
 *  ولا يتحرّك المخزون وتكلفة البضاعة إلا بقدر الكميات.
 *
 *  تشغيل:  php artisan test --filter=ReturnPosApiMixedReturnsTest
 */
class ReturnPosApiMixedReturnsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{auth:array, session:string, warehouse:string, customer:string} */
    private function pos(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $t = $auth['token'];

        $warehouse = $this->withToken($t)->postJson('/api/warehouses', [
            'name' => 'مخزن مختلط', 'code' => 'MIX-W', 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $device = $this->withToken($t)->postJson('/api/pos-devices', [
            'name' => 'كاشير مختلط', 'code' => 'MIX-D', 'warehouse_id' => $warehouse, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $session = $this->withToken($t)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device,
        ])->assertCreated()['data']['id'];
        $customer = $this->withToken($t)->postJson('/api/partners', [
            'name' => 'عميل مختلط', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        return ['auth' => $auth, 'session' => $session, 'warehouse' => $warehouse, 'customer' => $customer];
    }

    private function product(int $price, bool $track = false): Product
    {
        return Product::create([
            'name' => 'صنف مختلط', 'sale_price' => $price, 'track_inventory' => $track,
            'quantity_on_hand' => 0, 'avg_cost' => $track ? 4000 : 0,
        ]);
    }

    /** إجمالي سطر POS كما يحسبه الخادم (للدفع النقدي المطابق). */
    private function lineTotal(int $qty, int $price, int $rate, int $discount, bool $inclusive): int
    {
        $gross = $qty * $price - $discount;
        if ($inclusive) {
            return $gross;
        }

        return $gross + intdiv($gross * $rate + 50, 100);
    }

    private function checkout(array $ctx, Product $product, int $qty, int $price, int $rate = 15, int $discount = 0, bool $inclusive = false): Invoice
    {
        $response = $this->withToken($ctx['auth']['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $ctx['customer'],
            'pos_session_id' => $ctx['session'],
            'tax_inclusive' => $inclusive,
            'items' => [[
                'product_id' => $product->id, 'quantity' => $qty, 'unit_price' => $price,
                'tax_rate' => $rate, 'discount' => $discount,
            ]],
            'tenders' => ['cash' => $this->lineTotal($qty, $price, $rate, $discount, $inclusive)],
        ])->assertCreated();

        return Invoice::with('lines')->findOrFail($response['data']['id']);
    }

    private function posReturn(array $ctx, Invoice $invoice, int $qty, bool $restock = false): ReturnDocument
    {
        $response = $this->withToken($ctx['auth']['token'])->postJson('/api/pos/returns', [
            'idempotency_key' => (string) Str::uuid(),
            'pos_session_id' => $ctx['session'],
            'original_invoice_id' => $invoice->id,
            'payment_type' => 'credit',
            'restock' => $restock,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => $qty]],
        ])->assertCreated();

        return ReturnDocument::findOrFail($response['data']['id']);
    }

    private function apiReturn(array $ctx, Invoice $invoice, int $qty, ?int $price = null, bool $restock = false): ReturnDocument
    {
        $line = $invoice->lines->first();
        $id = $this->withToken($ctx['auth']['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id, 'restock' => $restock,
            'items' => [[
                'product_id' => $line->product_id, 'source_line_id' => $line->id,
                'quantity' => $qty, 'unit_price' => $price ?? (int) $line->unit_price,
            ]],
        ])->assertCreated()->json('data.id');
        $this->withToken($ctx['auth']['token'])->postJson("/api/returns/{$id}/post")->assertOk();

        return ReturnDocument::findOrFail($id);
    }

    /** @param list<array{0:string,1:int}> $sequence ['pos'|'api', كمية] */
    private function replay(array $ctx, Invoice $invoice, array $sequence, bool $restock = false): array
    {
        $returns = [];
        foreach ($sequence as [$kind, $qty]) {
            $returns[] = $kind === 'pos'
                ? $this->posReturn($ctx, $invoice, $qty, $restock)
                : $this->apiReturn($ctx, $invoice, $qty, null, $restock);
        }

        return $returns;
    }

    private function totals(array $returns): array
    {
        return [
            'net'   => (int) array_sum(array_map(fn ($r) => (int) $r->fresh()->subtotal, $returns)),
            'tax'   => (int) array_sum(array_map(fn ($r) => (int) $r->fresh()->tax_amount, $returns)),
            'total' => (int) array_sum(array_map(fn ($r) => (int) $r->fresh()->total, $returns)),
        ];
    }

    private function invoiceTotals(Invoice $invoice): array
    {
        $invoice = $invoice->fresh();

        return [
            'net'   => (int) $invoice->subtotal - (int) $invoice->discount,
            'tax'   => (int) $invoice->tax_amount,
            'total' => (int) $invoice->total,
        ];
    }

    /** رصيد دائن صافٍ لحساب بكوده (دائن − مدين). */
    private function creditBalance(string $code): int
    {
        $q = JournalLine::query()->whereHas('account', fn ($a) => $a->where('code', $code));

        return (int) (clone $q)->sum('credit') - (int) (clone $q)->sum('debit');
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'));
    }

    private function assertFullyReconciled(Invoice $invoice, array $returns): void
    {
        $this->assertSame($this->invoiceTotals($invoice), $this->totals($returns), 'Σ المرتجعات = الفاتورة هللةً بهللة.');
        $this->assertSame(0, $this->creditBalance('2120'), 'ضريبة المخرجات تتصفّر.');
        $this->assertSame(0, $this->creditBalance('4110'), 'الإيراد يتصفّر.');
        $this->assertBooksBalanced();
    }

    // ═══════════════════════════════════════════════════════════
    //  المسارات المختلطة — الأرقام المرجعية للمشكلة المُبلَّغ عنها
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function pos_then_pos_then_api_closes_the_last_halala_instead_of_stranding_it(): void
    {
        // 3 × 0.10: صافٍ 0.30، ضريبة 0.05 (4.5 تُقرَّب لأعلى)، إجمالي 0.35.
        // قبل الإصلاح: POS 0.01 + POS 0.01 + API 0.02 = 0.04 ← 0.01 عالقة في 2120.
        $ctx = $this->pos();
        $invoice = $this->checkout($ctx, $this->product(10), 3, 10);
        $this->assertSame([30, 5, 35], [(int) $invoice->subtotal, (int) $invoice->tax_amount, (int) $invoice->total]);

        $returns = $this->replay($ctx, $invoice, [['pos', 1], ['pos', 1], ['api', 1]]);

        $this->assertSame([1, 1, 3], array_map(fn ($r) => (int) $r->fresh()->tax_amount, $returns), 'الأخير يأخذ المتبقي 0.03.');
        $this->assertFullyReconciled($invoice, $returns);

        // التقرير القرائي يحسب مرتجعات POS متراكماً فلا يُبلِّغ لاحقها من الـAPI فرقاً.
        $this->assertSame([], app(ReturnVatDiscrepancyReport::class)->forCurrentTenant());

        $row = $this->withToken($ctx['auth']['token'])->getJson("/api/returns/returnable/sales/{$invoice->id}")
            ->assertOk()->json('data');
        $this->assertTrue($row['fully_returned']);
        $this->assertSame('0.00', $row['lines'][0]['remaining_tax']);
        $this->assertSame('0.00', $row['lines'][0]['remaining_net']);
        $this->assertFalse($row['lines'][0]['reduced_price_returned']);

        // لا ردّ بعد الاستنفاد، ولا مبالغ سالبة أو زائدة.
        $line = $invoice->lines->first();
        $this->withToken($ctx['auth']['token'])->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [['product_id' => $line->product_id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => 10]],
        ])->assertStatus(422);
    }

    /** @test */
    public function pos_then_api_then_pos_reconciles_exactly(): void
    {
        $ctx = $this->pos();
        $invoice = $this->checkout($ctx, $this->product(10), 3, 10);

        $returns = $this->replay($ctx, $invoice, [['pos', 1], ['api', 1], ['pos', 1]]);

        $this->assertFullyReconciled($invoice, $returns);
    }

    /** @test */
    public function an_inclusive_discounted_pos_sale_with_four_mixed_partial_returns_reconciles_exactly(): void
    {
        // 4 × 1.00 متضمّن الضريبة بخصم سطر 1.00 — تقريب الضريبة والخصم الصافي معاً.
        // (أرقامٌ تُخلّف هللة ضريبة عالقة قبل الإصلاح: POS، POS، API، API.)
        $ctx = $this->pos();
        $invoice = $this->checkout($ctx, $this->product(100), 4, 100, 15, 100, inclusive: true);
        $this->assertTrue((bool) $invoice->tax_inclusive);

        $returns = $this->replay($ctx, $invoice, [['pos', 1], ['pos', 1], ['api', 1], ['api', 1]]);

        $this->assertFullyReconciled($invoice, $returns);
    }

    /** @test */
    public function an_exclusive_discounted_sale_returned_pos_api_pos_api_reconciles_exactly(): void
    {
        // 5 × 1.01 بخصم سطر 0.77 (أرقامٌ تُخلّف هللة ضريبة عالقة قبل الإصلاح).
        $ctx = $this->pos();
        $invoice = $this->checkout($ctx, $this->product(101), 5, 101, 15, 77);

        $returns = $this->replay($ctx, $invoice, [['pos', 1], ['api', 1], ['pos', 2], ['api', 1]]);

        $this->assertFullyReconciled($invoice, $returns);
    }

    /** @test */
    public function the_final_part_does_not_refund_a_reduced_price_hold_back(): void
    {
        // 3 × 100.00: صافٍ 300.00، ضريبة 45.00. وحدة POS كاملة، ثم وحدة API بنصف
        // السعر (رسوم إعادة تخزين 50%)، ثم الأخيرة بسعر كامل: لا تستردّ الرسوم.
        $ctx = $this->pos();
        $invoice = $this->checkout($ctx, $this->product(10000), 3, 10000);
        $r1 = $this->posReturn($ctx, $invoice, 1);
        $r2 = $this->apiReturn($ctx, $invoice, 1, 5000);
        $r3 = $this->apiReturn($ctx, $invoice, 1);

        $this->assertSame([10000, 1500], [(int) $r1->fresh()->subtotal, (int) $r1->fresh()->tax_amount]);
        $this->assertSame([5000, 750], [(int) $r2->fresh()->subtotal, (int) $r2->fresh()->tax_amount]);
        $this->assertSame([10000, 1500], [(int) $r3->fresh()->subtotal, (int) $r3->fresh()->tax_amount], 'نصيب الوحدة لا المتبقي (15000/2250).');

        $sum = $this->totals([$r1, $r2, $r3]);
        $this->assertSame(['net' => 25000, 'tax' => 3750, 'total' => 28750], $sum);
        $this->assertLessThanOrEqual((int) $invoice->total, $sum['total']);
        // ما احتُجز هو الرسوم بالضبط: 50.00 صافٍ + 7.50 ضريبة.
        $this->assertSame(5000, (int) $invoice->subtotal - $sum['net']);
        $this->assertSame(750, (int) $invoice->tax_amount - $sum['tax']);

        $row = $this->withToken($ctx['auth']['token'])->getJson("/api/returns/returnable/sales/{$invoice->id}")->json('data.lines.0');
        $this->assertTrue($row['reduced_price_returned']);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function mixed_returns_leave_inventory_and_cogs_exactly_as_the_quantities_dictate(): void
    {
        $ctx = $this->pos();
        $goods = $this->product(10, track: true);
        app(InventoryService::class)->receiveStock($goods, 10, 4000, ['warehouse_id' => $ctx['warehouse']]);
        $stockBefore = (int) $goods->fresh()->quantity_on_hand;
        $inventoryBefore = $this->creditBalance('1140');
        $cogsBefore = $this->creditBalance('5110');

        $invoice = $this->checkout($ctx, $goods, 3, 10);
        $this->assertSame($stockBefore - 3, (int) $goods->fresh()->quantity_on_hand);

        $returns = $this->replay($ctx, $invoice, [['pos', 1], ['pos', 1], ['api', 1]], restock: true);

        $this->assertSame($stockBefore, (int) $goods->fresh()->quantity_on_hand, 'الكميات تعود كاملة.');
        $this->assertSame($inventoryBefore, $this->creditBalance('1140'), 'قيد المخزون يعود لما كان.');
        $this->assertSame($cogsBefore, $this->creditBalance('5110'), 'تكلفة البضاعة المباعة تُعكس كاملة.');
        $this->assertFullyReconciled($invoice, $returns);
    }

    // ═══════════════════════════════════════════════════════════
    //  خاصية عشوائية على مسار POS الحقيقي (خدمة POS نفسها لاشتقاق السطور)
    // ═══════════════════════════════════════════════════════════

    /**
     * مرتجع POS كما ينشئه `PosReturnService` تماماً: السطور المشتقة من
     * `buildSourceItems()` (خاص) ثم `ReturnService::create/post` بجلسة POS.
     * بلا طبقة HTTP/الجلسة/النقد فيبقى التكرار سريعاً.
     */
    private function posStyleReturn(Invoice $invoice, string $sessionId, int $qty): ReturnDocument
    {
        $service = app(PosReturnService::class);
        $method = new ReflectionMethod($service, 'buildSourceItems');
        $method->setAccessible(true);
        $items = $method->invoke(
            $service,
            $invoice->fresh('lines'),
            [['source_line_id' => $invoice->lines->first()->id, 'quantity' => $qty]]
        );

        $return = app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'pos_session_id' => $sessionId,
            'payment_type' => 'credit', 'tax_inclusive' => $invoice->tax_inclusive,
            'original_id' => $invoice->id, 'original_type' => Invoice::class,
        ], $items);

        return app(ReturnService::class)->post($return);
    }

    private function apiStyleReturn(Invoice $invoice, int $qty, ?int $price = null): ReturnDocument
    {
        $line = $invoice->lines->first();
        $return = app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
        ], [[
            'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => $qty, 'unit_price' => $price ?? (int) $line->unit_price,
        ]]);

        return app(ReturnService::class)->post($return);
    }

    /** @test */
    public function randomised_mixed_pos_and_api_sequences_always_reconcile_to_the_penny(): void
    {
        $ctx = $this->pos();
        $product = $this->product(1);
        mt_srand(20261011);

        for ($scenario = 0; $scenario < 60; $scenario++) {
            $qty = mt_rand(2, 12);
            $price = mt_rand(1, 60000);
            $rate = [15, 15, 5, 0][mt_rand(0, 3)];
            $inclusive = (bool) mt_rand(0, 1);
            $discount = mt_rand(0, 2) === 0 ? mt_rand(0, intdiv($qty * $price, 3)) : 0;

            $invoice = app(InvoiceService::class)->create([
                'partner_id' => $ctx['customer'], 'payment_type' => 'credit',
                'tax_inclusive' => $inclusive, 'pos_session_id' => $ctx['session'],
            ], [[
                'product_id' => $product->id, 'quantity' => $qty, 'unit_price' => $price,
                'tax_rate' => $rate, 'discount' => $discount ?: null,
            ]]);
            $invoice = app(InvoiceService::class)->post($invoice);

            $parts = [];
            for ($left = $qty; $left > 0;) {
                $take = mt_rand(1, $left);
                $parts[] = $take;
                $left -= $take;
            }

            $returns = [];
            $prefixOk = true;
            foreach ($parts as $q) {
                $returns[] = mt_rand(0, 1)
                    ? $this->posStyleReturn($invoice, $ctx['session'], $q)
                    : $this->apiStyleReturn($invoice, $q);

                $running = $this->totals($returns);
                $charged = $this->invoiceTotals($invoice);
                $prefixOk = $prefixOk && $running['net'] <= $charged['net'] && $running['tax'] <= $charged['tax'] && $running['total'] <= $charged['total'];
            }

            $this->assertTrue($prefixOk, "السيناريو {$scenario}: لا تجاوز في أي خطوة.");
            $this->assertSame(
                $this->invoiceTotals($invoice),
                $this->totals($returns),
                "السيناريو {$scenario}: " . json_encode(compact('qty', 'price', 'rate', 'inclusive', 'discount', 'parts'))
            );
        }

        $this->assertSame(0, $this->creditBalance('2120'));
        $this->assertSame(0, $this->creditBalance('4110'));
        $this->assertBooksBalanced();
    }

    /** @test */
    public function randomised_sequences_with_a_reduced_price_return_never_exceed_the_invoice_or_go_negative(): void
    {
        $ctx = $this->pos();
        $product = $this->product(1);
        mt_srand(20261012);

        for ($scenario = 0; $scenario < 30; $scenario++) {
            $qty = mt_rand(2, 8);
            $price = mt_rand(100, 60000);
            $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create([
                'partner_id' => $ctx['customer'], 'payment_type' => 'credit',
                'tax_inclusive' => (bool) mt_rand(0, 1), 'pos_session_id' => $ctx['session'],
            ], [[
                'product_id' => $product->id, 'quantity' => $qty, 'unit_price' => $price, 'tax_rate' => 15,
            ]]));

            $reducedAt = mt_rand(0, $qty - 1);
            $returns = [];
            for ($i = 0; $i < $qty; $i++) {
                $returns[] = match (true) {
                    $i === $reducedAt => $this->apiStyleReturn($invoice, 1, intdiv($price, 2)),
                    (bool) mt_rand(0, 1) => $this->posStyleReturn($invoice, $ctx['session'], 1),
                    default => $this->apiStyleReturn($invoice, 1),
                };
                foreach ($returns[array_key_last($returns)]->fresh()->lines as $line) {
                    $this->assertGreaterThanOrEqual(0, (int) $line->line_tax);
                    $this->assertGreaterThanOrEqual(0, (int) $line->line_subtotal - (int) $line->line_discount);
                }
            }

            $sum = $this->totals($returns);
            $charged = $this->invoiceTotals($invoice);
            $this->assertLessThanOrEqual($charged['net'], $sum['net'], "السيناريو {$scenario}");
            $this->assertLessThanOrEqual($charged['tax'], $sum['tax'], "السيناريو {$scenario}");
            $this->assertLessThanOrEqual($charged['total'], $sum['total'], "السيناريو {$scenario}");
        }

        $this->assertBooksBalanced();
    }

    /** @test */
    public function a_return_after_a_complete_return_is_refused_in_the_service_too(): void
    {
        $ctx = $this->pos();
        $product = $this->product(1);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create([
            'partner_id' => $ctx['customer'], 'payment_type' => 'credit', 'pos_session_id' => $ctx['session'],
        ], [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 333, 'tax_rate' => 15]]));

        $this->posStyleReturn($invoice, $ctx['session'], 1);
        $this->apiStyleReturn($invoice, 1);

        $this->expectException(RuntimeException::class);
        $this->apiStyleReturn($invoice, 1);
    }
}

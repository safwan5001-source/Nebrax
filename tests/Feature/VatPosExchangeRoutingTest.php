<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\PosExchange;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Services\Accounting\AccountRoutingService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * REM-06 / ACC-02: ساق المرتجع في استبدال POS تمرّ عبر `ReturnService` (فتحلّ `tax_output` الحالي)، وساق
 * الاستبدال عبر `InvoiceService` (كما كانت). `PosExchangeService` نفسه لا يرحّل ضريبة ولم يُعدَّل — قيده الوحيد
 * هو فائض الاسترداد (مدين 1130 / دائن 1110) ولا علاقة له بحسابات الضريبة.
 *
 * بيع 100.00 + 15% بتاريخ سابق على إعادة التعيين ثم استبداله بصنف 100.00 بعد إعادة تعيين `tax_output` إلى 2125:
 *   ساق المرتجع:  مدين 4110 10000 · مدين 2125 1500 · دائن 1130/1110 11500
 *   ساق البديل:   دائن 2125 1500 (فاتورة جديدة)
 *   صافي 2125 = صفر · 2120 يبقى دائناً 15.00 من البيع الأصلي · مجموع الدور (تقرير REM-05) = 15.00
 *
 * تشغيل: php artisan test --filter=VatPosExchangeRoutingTest
 */
class VatPosExchangeRoutingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @return array{session_id:string,warehouse_id:string} */
    private function openSession(array $auth): array
    {
        $n = ++$this->sequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن إتمام مرتجع {$n}", 'code' => "POS-VX-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير إتمام مرتجع {$n}", 'code' => "POS-VX-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
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

    /** @test */
    public function the_exchange_return_leg_follows_the_current_tax_output_role_and_the_replacement_leg_too(): void
    {
        $auth = $this->registerTenant('pos-vat-exchange', 'owner@pos-vat-exchange.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $invoice = $this->checkout($auth, $partnerId, $session['session_id']);       // VAT 15.00 دائن 2120 (قبل إعادة التعيين)

        $custom = Account::create([
            'tenant_id' => $auth['tenant_id'], 'code' => '2125', 'name' => 'ضريبة مخرجات مخصصة', 'type' => 'liability',
            'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true,
        ]);
        app(AccountRoutingService::class)->setMapping('tax_output', $custom->id, null);

        $payload = $this->exchangePayload($auth, $session['session_id'], $invoice, (string) Str::uuid());
        $first = $this->withToken($auth['token'])->postJson('/api/pos/exchanges', $payload)->assertCreated();
        app(TenantContext::class)->set($auth['tenant_id']);
        $exchange = PosExchange::findOrFail($first['data']['id']);

        // ساق المرتجع
        $returnLines = JournalEntry::with('lines.account')
            ->where('source_type', ReturnDocument::class)->where('source_id', $exchange->return_id)->sole()->lines;
        $byCode = $returnLines->mapWithKeys(fn ($l) => [$l->account->code => [(int) $l->debit, (int) $l->credit]])->all();
        $this->assertSame([10000, 0], $byCode['4110']);
        $this->assertSame([1500, 0], $byCode['2125']);
        $this->assertArrayNotHasKey('2120', $byCode);
        $this->assertSame((int) $returnLines->sum('debit'), (int) $returnLines->sum('credit'));

        // ساق البديل (فاتورة جديدة): VAT دائن 2125.
        $replacementLines = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $exchange->replacement_invoice_id)->sole()->lines;
        $vat = $replacementLines->first(fn ($l) => (int) $l->credit === 1500);
        $this->assertSame('2125', $vat->account->code);

        // الأرصدة: 2125 صفر، 2120 دائن 15.00 من البيع الأصلي؛ لا قيد مكرر للمرتجع.
        $net = fn (string $code) => (int) JournalLine::where('account_id', Account::where('code', $code)->value('id'))->sum('debit')
            - (int) JournalLine::where('account_id', Account::where('code', $code)->value('id'))->sum('credit');
        $this->assertSame(0, $net('2125'));
        $this->assertSame(-1500, $net('2120'));
        $this->assertSame(1, JournalEntry::where('source_type', ReturnDocument::class)->where('source_id', $exchange->return_id)->count());
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'));

        // REM-05: مجموع حسابات الدور = 15.00 (بيع − مرتجع + بديل)، موثَّق.
        $report = app(ReportService::class)->taxReport();
        $this->assertSame(1500, $report['output_vat']);
        $this->assertSame('verified', $report['verification']['status']);
    }
}

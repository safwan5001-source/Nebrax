<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentReversalService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class PaymentReversalTest extends TestCase
{
    use RefreshDatabase;

    private Partner $customer;
    private PaymentService $payments;
    private PaymentReversalService $reversals;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'شركة عكس السندات',
            'slug' => 'payment-reversal',
            'vat_number' => '300000000000091',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $this->customer = Partner::create(['name' => 'عميل العكس', 'type' => 'customer']);
        $this->payments = app(PaymentService::class);
        $this->reversals = app(PaymentReversalService::class);
    }

    private function invoice(): Invoice
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000]]
        );

        return app(InvoiceService::class)->post($draft);
    }

    private function collect(Invoice $invoice, int $amount): Payment
    {
        return $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => $amount,
            'direction' => 'received',
            'method' => 'cash',
        ]));
    }

    /** @test */
    public function posted_receipt_is_reversed_from_its_original_journal_and_keeps_allocation_history(): void
    {
        $invoice = $this->invoice();
        $payment = $this->collect($invoice, $invoice->total);
        $originalEntryId = $payment->journal_entry_id;
        $allocationIds = $payment->allocations()->pluck('id')->all();

        $this->assertSame('paid', $invoice->fresh()->payment_status);

        $reversed = $this->reversals->reverse($payment, now()->toDateString(), 'تصحيح سند قبض');

        $this->assertTrue($reversed->isReversed());
        $this->assertSame($originalEntryId, $reversed->journal_entry_id);
        $this->assertNotNull($reversed->reversal_entry_id);
        $this->assertNotNull($reversed->reversed_at);
        $this->assertSame($allocationIds, $reversed->allocations()->pluck('id')->all());

        $original = $reversed->journalEntry()->with('lines')->firstOrFail();
        $reversal = $reversed->reversalEntry()->with('lines')->firstOrFail();
        $this->assertSame('reversed', $original->status);
        $this->assertSame($original->id, $reversal->reversal_of);
        $this->assertSame($original->lines->sum('debit'), $reversal->lines->sum('credit'));
        $this->assertSame($original->lines->sum('credit'), $reversal->lines->sum('debit'));

        $invoice->refresh();
        $this->assertSame(0, $invoice->paid_amount);
        $this->assertSame('unpaid', $invoice->payment_status);
    }

    /** @test */
    public function reversing_one_of_multiple_receipts_recalculates_from_remaining_posted_allocations(): void
    {
        $invoice = $this->invoice();
        $first = $this->collect($invoice, 40000);
        $second = $this->collect($invoice, $invoice->total - 40000);

        $this->assertSame('paid', $invoice->fresh()->payment_status);

        $this->reversals->reverse($second);

        $invoice->refresh();
        $this->assertSame(40000, $invoice->paid_amount);
        $this->assertSame('partial', $invoice->payment_status);
        $this->assertTrue($first->fresh()->isPosted());
        $this->assertTrue($second->fresh()->isReversed());
    }

    /** @test */
    public function draft_payment_cannot_be_reversed(): void
    {
        $payment = $this->payments->create([
            'partner_id' => $this->customer->id,
            'amount' => 10000,
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير مرحّل');
        $this->reversals->reverse($payment);
    }

    /** @test */
    public function payment_cannot_be_reversed_twice(): void
    {
        $invoice = $this->invoice();
        $payment = $this->collect($invoice, $invoice->total);
        $this->reversals->reverse($payment);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير مرحّل');
        $this->reversals->reverse($payment->fresh());
    }

    /** @test */
    public function missing_original_journal_fails_without_changing_payment_or_invoice(): void
    {
        $invoice = $this->invoice();
        $payment = $this->collect($invoice, $invoice->total);
        $paidBefore = $invoice->fresh()->paid_amount;

        // يحاكي مرجعاً تاريخياً مفقوداً؛ يجب أن يتوقف العكس قبل أي أثر جديد.
        $payment->update(['journal_entry_id' => null]);

        try {
            $this->reversals->reverse($payment->fresh());
            $this->fail('Expected reversal to fail without an original journal.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('بلا قيد أصلي', $e->getMessage());
        }

        $payment->refresh();
        $invoice->refresh();
        $this->assertSame('posted', $payment->status);
        $this->assertNull($payment->reversal_entry_id);
        $this->assertSame($paidBefore, $invoice->paid_amount);
        $this->assertSame('paid', $invoice->payment_status);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Notification;
use App\Models\Partner;
use App\Models\PosSession;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PosSessionNotificationBridge;
use App\Services\Accounting\ReceivablesNotificationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

class ReceivablesPosNotificationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    public function test_receivables_only_notify_posted_invoices_with_remaining_balance_and_dedupe_same_day(): void
    {
        $auth = $this->registerTenant('notif5-ar', 'notif5-ar@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $partner->id, 'payment_type' => 'credit', 'due_date' => '2026-09-08'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
        $invoice = app(InvoiceService::class)->post($invoice);

        $journals = JournalEntry::count();
        $lines = JournalLine::count();
        $today = Carbon::parse('2026-09-08');
        $service = app(ReceivablesNotificationService::class);
        $service->scanTenant($auth['tenant_id'], $today);
        $service->scanTenant($auth['tenant_id'], $today);

        $this->assertSame(1, Notification::where('source_type', 'invoice')->where('source_id', $invoice->id)->count());
        $notification = Notification::where('source_id', $invoice->id)->firstOrFail();
        $this->assertSame('receivables.due_today', $notification->type);
        $this->assertSame('view_receivable_invoice', $notification->action);
        $this->assertSame($journals, JournalEntry::count());
        $this->assertSame($lines, JournalLine::count());

        $invoice->update(['paid_amount' => $invoice->total, 'payment_status' => 'paid', 'is_paid' => true]);
        $service->scanTenant($auth['tenant_id'], $today->copy()->addDay());
        $this->assertSame(1, Notification::where('source_id', $invoice->id)->count());
    }

    public function test_pos_projection_notifies_only_actionable_pending_states_without_accounting_mutation(): void
    {
        $auth = $this->registerTenant('notif5-pos', 'notif5-pos@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = PosSession::create([
            'number' => 'POS-NOTIF-1',
            'status' => 'closed',
            'handover_status' => 'pending',
            'difference_status' => 'pending',
            'opening_balance' => 10000,
            'closing_balance' => 9000,
            'expected_balance' => 10000,
            'difference' => -1000,
            'closed_at' => now(),
        ]);

        $journals = JournalEntry::count();
        $lines = JournalLine::count();
        $service = app(PosSessionNotificationBridge::class);
        $service->scanTenant($auth['tenant_id']);
        $service->scanTenant($auth['tenant_id']);

        $notifications = Notification::where('source_type', 'pos_session')->where('source_id', $session->id)->get();
        $this->assertCount(2, $notifications);
        $this->assertEqualsCanonicalizing(['pos.variance_pending', 'pos.handover_pending'], $notifications->pluck('type')->all());
        $this->assertSame($journals, JournalEntry::count());
        $this->assertSame($lines, JournalLine::count());

        $session->update(['difference_status' => 'acknowledged', 'handover_status' => 'confirmed']);
        $service->scanTenant($auth['tenant_id']);
        $this->assertSame(2, Notification::where('source_id', $session->id)->count());
    }
}

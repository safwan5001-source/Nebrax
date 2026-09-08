<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Notification;
use App\Models\Partner;
use App\Models\Tenant;
use App\Models\User;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\Accounting\InvoiceService;
use App\Services\NotificationService;
use App\Services\Accounting\ZatcaSubmissionService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use RuntimeException;
use Tests\TestCase;

/**
 * جسر إشعارات ZATCA (PR-NOTIF-4): كل محاولة إرسال فاشلة/مرفوضة حدثٌ دائم مرة
 * واحدة، النجاح لا يُنبّه أبداً، ولا تأثير على النتيجة المحفوظة مهما فشل الإشعار.
 */
class ZatcaNotificationBridgeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private array $auth;
    private Partner $customer;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('zatca-notif', 'zatca-notif@example.test');
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->owner = User::where('tenant_id', $this->auth['tenant_id'])->firstOrFail();
        $this->customer = Partner::create(['name' => 'عميل ZATCA', 'type' => 'customer']);
    }

    private function postedInvoice(): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function pendingAttempt(Invoice $invoice, string $key): ZatcaSubmissionAttempt
    {
        $response = $this->withToken($this->auth['token'])
            ->withHeader('Idempotency-Key', $key)
            ->postJson("/api/invoices/{$invoice->id}/zatca/submissions")
            ->assertStatus(202);

        return ZatcaSubmissionAttempt::findOrFail($response['data']['id']);
    }

    /** @return Collection<int, Notification> */
    private function notificationsFor(Invoice $invoice): Collection
    {
        return Notification::query()
            ->where('tenant_id', $this->auth['tenant_id'])
            ->where('source_type', 'invoice')
            ->where('source_id', $invoice->id)
            ->get();
    }

    /** @test */
    public function a_rejected_submission_delivers_one_notification(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'rejected-1');

        app(ZatcaSubmissionService::class)->complete($attempt, 'rejected', 400, 'invalid_signature', 'توقيع غير صالح');

        $notifications = $this->notificationsFor($invoice);
        $this->assertCount(1, $notifications);
        $this->assertSame($this->owner->id, $notifications->first()->recipient_id);
        $this->assertSame('zatca.submission_rejected', $notifications->first()->type);
        $this->assertSame('critical', $notifications->first()->severity);
        $this->assertSame('view_zatca_submission', $notifications->first()->action);
    }

    /** @test */
    public function a_failed_submission_delivers_one_notification(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'failed-1');

        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable', 'Temporary failure');

        $notifications = $this->notificationsFor($invoice);
        $this->assertCount(1, $notifications);
        $this->assertSame('zatca.submission_failed', $notifications->first()->type);
    }

    /** @test */
    public function an_accepted_submission_never_notifies(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'accepted-1');

        app(ZatcaSubmissionService::class)->complete($attempt, 'accepted', 200, 'accepted');

        $this->assertCount(0, $this->notificationsFor($invoice));
    }

    /** @test */
    public function a_retried_attempt_after_a_failure_delivers_a_second_independent_notification(): void
    {
        $invoice = $this->postedInvoice();
        $first = $this->pendingAttempt($invoice, 'retry-1');
        app(ZatcaSubmissionService::class)->complete($first, 'failed', 503, 'gateway_unavailable');
        $this->assertCount(1, $this->notificationsFor($invoice));

        $second = $this->pendingAttempt($invoice, 'retry-2');
        app(ZatcaSubmissionService::class)->complete($second, 'rejected', 400, 'invalid_signature');

        $notifications = $this->notificationsFor($invoice);
        $this->assertCount(2, $notifications);
        $this->assertNotSame($first->id, $second->id);
    }

    /** @test */
    public function completing_the_same_attempt_twice_is_rejected_by_the_existing_guard_and_cannot_double_notify(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'double-1');
        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable');

        $this->expectException(RuntimeException::class);
        app(ZatcaSubmissionService::class)->complete($attempt->fresh(), 'failed', 503, 'gateway_unavailable');
    }

    /** @test */
    public function tenant_isolation_keeps_zatca_notifications_separate(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'tenant-a-1');
        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable');

        $authB = $this->registerTenant('zatca-notif-b', 'zatca-notif-b@example.test');
        app(TenantContext::class)->set($authB['tenant_id']);
        // الفرع النشط بُعد كتابة بلا Global Scope (انظر BranchContext) — يبقى
        // من طلب HTTP السابق لمستأجر آخر ما لم يُنسَ صراحةً هنا، فيسم به وسمُ
        // إنشاء مباشر خارج طلب HTTP فرعاً أجنبياً على مستنداتٍ لمستأجر جديد.
        app(BranchContext::class)->forget();
        $customerB = Partner::create(['name' => 'عميل ب', 'type' => 'customer']);
        $invoiceB = app(InvoiceService::class)->create(
            ['partner_id' => $customerB->id, 'payment_type' => 'credit'],
            [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        );
        $invoiceB = app(InvoiceService::class)->post($invoiceB);
        $attemptB = $this->withToken($authB['token'])
            ->withHeader('Idempotency-Key', 'tenant-b-1')
            ->postJson("/api/invoices/{$invoiceB->id}/zatca/submissions")
            ->assertStatus(202);
        app(ZatcaSubmissionService::class)->complete(ZatcaSubmissionAttempt::findOrFail($attemptB['data']['id']), 'failed', 503, 'gateway_unavailable');

        $this->assertSame(1, Notification::withoutGlobalScopes()->where('tenant_id', $this->auth['tenant_id'])->count());
        $this->assertSame(1, Notification::withoutGlobalScopes()->where('tenant_id', $authB['tenant_id'])->count());
    }

    /** @test */
    public function only_invoices_manage_holders_are_notified(): void
    {
        $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@zatca-notif.test');
        $staff = User::where('email', 'staff@zatca-notif.test')->first();

        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'rbac-1');
        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable');

        $recipients = $this->notificationsFor($invoice)->pluck('recipient_id')->all();
        $this->assertContains($this->owner->id, $recipients);
        // staff يملك invoices.view فقط لا invoices.manage — لا يصله.
        $this->assertNotContains($staff->id, $recipients);
    }

    /** @test */
    public function no_raw_response_message_or_payload_leaks_into_the_notification(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'leak-1');

        app(ZatcaSubmissionService::class)->complete(
            $attempt,
            'rejected',
            400,
            'XSD_VALIDATION_ERROR',
            'رسالة تفصيلية طويلة قد تحمل بيانات حسّاسة من استجابة ZATCA الخام.',
            ['certificate' => 'SENSITIVE_CERT_MATERIAL', 'raw' => 'full-response-body'],
        );

        $notification = $this->notificationsFor($invoice)->first();
        $this->assertStringContainsString('XSD_VALIDATION_ERROR', $notification->message);
        $this->assertStringNotContainsString('رسالة تفصيلية طويلة', $notification->message);
        $this->assertStringNotContainsString('SENSITIVE_CERT_MATERIAL', $notification->message);
        $this->assertArrayNotHasKey('response_payload', $notification->data);
        $this->assertArrayNotHasKey('response_message', $notification->data);
        $this->assertArrayNotHasKey('certificate', $notification->data);
        $this->assertSame(['submission_type'], array_keys($notification->data));
    }

    /** @test */
    public function a_notification_delivery_failure_never_corrupts_the_saved_zatca_result(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'broken-notify-1');

        $broken = new class extends NotificationService
        {
            public function deliver(array $payload): \App\Models\Notification
            {
                throw new RuntimeException('عطل متعمَّد في طبقة الإشعارات لإثبات العزل.');
            }
        };
        app()->instance(NotificationService::class, $broken);

        $result = app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 500, 'gateway_error');

        $this->assertSame('failed', $result->status);
        $this->assertSame('failed', $attempt->fresh()->status);
        $this->assertSame(500, $attempt->fresh()->response_http_status);
        $this->assertSame(0, Notification::where('tenant_id', $this->auth['tenant_id'])->count());
    }
}

<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Notification;
use App\Models\Partner;
use App\Models\Role;
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

    private function restoreTenantContext(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
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

        $this->restoreTenantContext($this->auth['tenant_id']);
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

        $this->restoreTenantContext($this->auth['tenant_id']);
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

        $this->restoreTenantContext($this->auth['tenant_id']);
        app(ZatcaSubmissionService::class)->complete($attempt, 'accepted', 200, 'accepted');

        $this->assertCount(0, $this->notificationsFor($invoice));
    }

    /** @test */
    public function a_retried_attempt_after_a_failure_delivers_a_second_independent_notification(): void
    {
        $invoice = $this->postedInvoice();
        $first = $this->pendingAttempt($invoice, 'retry-1');
        $this->restoreTenantContext($this->auth['tenant_id']);
        app(ZatcaSubmissionService::class)->complete($first, 'failed', 503, 'gateway_unavailable');
        $this->assertCount(1, $this->notificationsFor($invoice));

        $second = $this->pendingAttempt($invoice, 'retry-2');
        $this->restoreTenantContext($this->auth['tenant_id']);
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
        $this->restoreTenantContext($this->auth['tenant_id']);
        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable');

        $this->expectException(RuntimeException::class);
        app(ZatcaSubmissionService::class)->complete($attempt->fresh(), 'failed', 503, 'gateway_unavailable');
    }

    /** @test */
    public function tenant_isolation_keeps_zatca_notifications_separate(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'tenant-a-1');
        $this->restoreTenantContext($this->auth['tenant_id']);
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
        $this->restoreTenantContext($authB['tenant_id']);
        app(ZatcaSubmissionService::class)->complete(ZatcaSubmissionAttempt::findOrFail($attemptB['data']['id']), 'failed', 503, 'gateway_unavailable');

        $this->assertSame(1, Notification::withoutGlobalScopes()->where('tenant_id', $this->auth['tenant_id'])->count());
        $this->assertSame(1, Notification::withoutGlobalScopes()->where('tenant_id', $authB['tenant_id'])->count());
    }

    /**
     * @param array<int, string> $permissions صلاحيات صريحة مخزَّنة (كما في بيانات الإنتاج: صفوف `roles` هي المرجع).
     * @param array<int, string> $branchIds فارغة = غير مقيَّد بفرع
     */
    private function userWithRole(string $slug, array $permissions, string $email, bool $active = true, array $branchIds = [], ?string $tenantId = null): User
    {
        $tenantId ??= $this->auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        if (! Role::where('slug', $slug)->exists()) {
            Role::create([
                'tenant_id' => $tenantId, 'slug' => $slug, 'name' => $slug,
                'permissions' => $permissions, 'is_system' => false,
            ]);
        }
        $user = User::create([
            'tenant_id' => $tenantId, 'name' => $slug, 'email' => $email,
            'password' => 'password123', 'role' => $slug, 'is_active' => $active,
        ]);
        if ($branchIds !== []) {
            $user->branches()->sync($branchIds);
        }

        return $user;
    }

    private function failedAttempt(string $key, ?Invoice $invoice = null): array
    {
        $invoice ??= $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, $key);
        $this->restoreTenantContext($this->auth['tenant_id']);
        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable');

        return [$invoice, $attempt];
    }

    /** @test */
    public function only_zatca_submit_holders_are_notified(): void
    {
        $this->tokenForRole($this->auth['tenant_id'], 'staff', 'staff@zatca-notif.test');
        $this->tokenForRole($this->auth['tenant_id'], 'accountant', 'acc@zatca-notif.test');
        $staff = User::where('email', 'staff@zatca-notif.test')->first();
        $accountant = User::where('email', 'acc@zatca-notif.test')->first();

        [$invoice] = $this->failedAttempt('rbac-1');

        $recipients = $this->notificationsFor($invoice)->pluck('recipient_id')->all();
        $this->assertContains($this->owner->id, $recipients);       // owner: `*`
        $this->assertContains($accountant->id, $recipients);        // accountant يملك zatca.submit
        // staff يملك zatca.view فقط — لا يصله.
        $this->assertNotContains($staff->id, $recipients);
    }

    /** @test */
    public function separated_permissions_notify_only_whoever_can_actually_submit(): void
    {
        $submitOnly = $this->userWithRole('only_submit', ['zatca.submit'], 'submit-only@zatca-notif.test');
        $both       = $this->userWithRole('manage_and_submit', ['invoices.view', 'invoices.manage', 'zatca.view', 'zatca.submit'], 'both@zatca-notif.test');
        // كان يصله التنبيه قبل REM-37 لأن invoices.manage كانت سلطة الإرسال؛ لم يعد قادراً على الإرسال فلا يصله.
        $manageOnly = $this->userWithRole('only_manage', ['invoices.view', 'invoices.manage', 'zatca.view'], 'manage-only@zatca-notif.test');
        $viewOnly   = $this->userWithRole('only_view', ['invoices.view', 'zatca.view'], 'view-only@zatca-notif.test');
        $nothing    = $this->userWithRole('no_zatca', ['invoices.view'], 'nothing@zatca-notif.test');

        [$invoice] = $this->failedAttempt('sod-1');

        $recipients = $this->notificationsFor($invoice)->pluck('recipient_id')->sort()->values()->all();
        $expected = collect([$this->owner->id, $submitOnly->id, $both->id])->sort()->values()->all();
        $this->assertSame($expected, $recipients);
        foreach ([$manageOnly, $viewOnly, $nothing] as $excluded) {
            $this->assertNotContains($excluded->id, $recipients, "{$excluded->role} must not be notified");
        }
    }

    /** @test */
    public function the_recipient_predicate_matches_the_actual_route_authorization_for_every_role(): void
    {
        $roles = [
            'p_submit'  => ['zatca.submit'],
            'p_manage'  => ['invoices.view', 'invoices.manage'],
            'p_view'    => ['zatca.view'],
            'p_both'    => ['invoices.view', 'invoices.manage', 'zatca.submit'],
            'p_none'    => ['invoices.view'],
        ];
        $users = [];
        foreach ($roles as $slug => $perms) {
            $users[$slug] = $this->userWithRole($slug, $perms, "{$slug}@zatca-notif.test");
        }

        // من يصله التنبيه؟
        [$invoice] = $this->failedAttempt('parity-1');
        $recipients = $this->notificationsFor($invoice)->pluck('recipient_id')->all();

        // ومن يستطيع فعلاً إنشاء محاولة إرسال عبر المسار الحقيقي؟ (202 مسموح، 403 مرفوض.)
        foreach ($users as $slug => $user) {
            $this->restoreTenantContext($this->auth['tenant_id']);
            $token = $user->createToken('api')->plainTextToken;
            $probe = $this->postedInvoice();
            $status = $this->withToken($token)->withHeader('Idempotency-Key', "parity-{$slug}")
                ->postJson("/api/invoices/{$probe->id}/zatca/submissions")->getStatusCode();

            $this->assertContains($status, [202, 403], "{$slug}: unexpected status {$status}");
            $this->assertSame(
                $status === 202,
                in_array($user->id, $recipients, true),
                "{$slug}: authorized-to-submit ({$status}) must equal notified",
            );
        }
        // نصف الأدوار على الأقل يجرّب كلا الجانبين فعلاً.
        $this->assertContains($users['p_submit']->id, $recipients);
        $this->assertNotContains($users['p_manage']->id, $recipients);
    }

    /** @test */
    public function inactive_submitters_are_never_notified(): void
    {
        $inactive = $this->userWithRole('inactive_submit', ['zatca.submit'], 'inactive@zatca-notif.test', active: false);

        [$invoice] = $this->failedAttempt('inactive-1');

        $this->assertNotContains($inactive->id, $this->notificationsFor($invoice)->pluck('recipient_id')->all());
    }

    /** @test */
    public function a_submitter_in_another_tenant_never_receives_this_tenants_alert(): void
    {
        $authB = $this->registerTenant('zatca-notif-c', 'zatca-notif-c@example.test');
        $foreign = $this->userWithRole('foreign_submit', ['zatca.submit'], 'foreign@zatca-notif.test', tenantId: $authB['tenant_id']);
        $this->restoreTenantContext($this->auth['tenant_id']);

        [$invoice] = $this->failedAttempt('xtenant-1');

        $this->assertNotContains($foreign->id, $this->notificationsFor($invoice)->pluck('recipient_id')->all());
        $this->assertSame(0, Notification::withoutGlobalScopes()->where('tenant_id', $authB['tenant_id'])->count());
    }

    /** @test */
    public function branch_visibility_still_applies_on_top_of_the_submit_permission(): void
    {
        $owner = $this->auth['token'];
        $main = $this->withToken($owner)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $other = $this->withToken($owner)->postJson('/api/branches', ['name' => 'فرع ثانٍ'])->assertCreated()['data']['id'];

        $inBranch   = $this->userWithRole('branch_submit_a', ['zatca.submit'], 'in-branch@zatca-notif.test', branchIds: [$other]);
        $outBranch  = $this->userWithRole('branch_submit_b', ['zatca.submit'], 'out-branch@zatca-notif.test', branchIds: [$main]);
        $unrestricted = $this->userWithRole('branch_submit_c', ['zatca.submit'], 'free@zatca-notif.test');

        $draft = $this->withToken($owner)->withHeaders(['X-Branch-Id' => $other])->postJson('/api/invoices', [
            'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'items' => [['description' => 'خدمة', 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->withToken($owner)->withHeaders(['X-Branch-Id' => $other])->postJson("/api/invoices/{$draft['id']}/post")->assertOk();
        $response = $this->withToken($owner)->withHeaders(['X-Branch-Id' => $other, 'Idempotency-Key' => 'branch-1'])
            ->postJson("/api/invoices/{$draft['id']}/zatca/submissions")->assertStatus(202);
        $attempt = ZatcaSubmissionAttempt::findOrFail($response['data']['id']);
        $this->assertSame($other, $attempt->branch_id, 'test premise: the attempt is bound to the non-default branch');

        $this->restoreTenantContext($this->auth['tenant_id']);
        app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 503, 'gateway_unavailable');

        $recipients = Notification::query()->where('tenant_id', $this->auth['tenant_id'])
            ->where('source_id', $draft['id'])->pluck('recipient_id')->all();
        $this->assertContains($inBranch->id, $recipients);
        $this->assertContains($unrestricted->id, $recipients);
        $this->assertNotContains($outBranch->id, $recipients);
    }

    /** @test */
    public function no_raw_response_message_or_payload_leaks_into_the_notification(): void
    {
        $invoice = $this->postedInvoice();
        $attempt = $this->pendingAttempt($invoice, 'leak-1');

        $this->restoreTenantContext($this->auth['tenant_id']);
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

        $this->restoreTenantContext($this->auth['tenant_id']);
        $result = app(ZatcaSubmissionService::class)->complete($attempt, 'failed', 500, 'gateway_error');

        $this->assertSame('failed', $result->status);
        $this->assertSame('failed', $attempt->fresh()->status);
        $this->assertSame(500, $attempt->fresh()->response_http_status);
        $this->assertSame(0, Notification::where('tenant_id', $this->auth['tenant_id'])->count());
    }
}

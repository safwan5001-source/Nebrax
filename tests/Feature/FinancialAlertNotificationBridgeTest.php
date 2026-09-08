<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FinancialControlAlert;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Notification;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Tests\TestCase;

/**
 * جسر إشعارات الرقابة المالية (PR-NOTIF-4): لا إشعار للفحص المتكرر بلا جديد،
 * إشعار عند نشاطٍ جديد أو إعادة فتح، عزل المستأجر، ومستلمون محافظون.
 *
 * الجسر مُستدعًى فقط من نقطتَي التشغيل القائمتين (الأمر المجدول والتشغيل
 * اليدوي عبر API) — لا من `FinancialControlService::scan()` مباشرة، فكل
 * اختبار هنا يُشغِّل الفحص عبر إحداهما، لا عبر استدعاء الخدمة مباشرة.
 */
class FinancialAlertNotificationBridgeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected Tenant $tenant;
    protected User $owner;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة الرقابة',
            'slug' => 'controls-notif',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->owner = User::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'المالك',
            'email' => 'owner@controls-notif.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);

        Settings::put('finance', ['financial_alerts_enabled' => true], $this->tenant);
    }

    private function unbalancedEntry(string $number = 'CTRL-BAD-001'): JournalEntry
    {
        $entry = JournalEntry::create([
            'number' => $number,
            'entry_date' => now()->toDateString(),
            'description' => 'حالة اختبار فساد قيد',
            'status' => 'posted',
            'posted_at' => now(),
        ]);

        JournalLine::create([
            'journal_entry_id' => $entry->id,
            'account_id' => Account::where('code', '1110')->value('id'),
            'debit' => 10000,
            'credit' => 0,
            'description' => 'سطر اختبار غير متوازن',
        ]);

        return $entry;
    }

    /** يشغّل الفحص عبر الأمر المجدول القائم — نقطة الاستدعاء الحقيقية للجسر. */
    private function scan(?string $tenantId = null, bool $force = false): void
    {
        $options = ['--tenant' => $tenantId ?? $this->tenant->id];
        if ($force) {
            $options['--force'] = true;
        }
        $this->artisan('finance:scan-controls', $options)->assertSuccessful();
    }

    /** @return Collection<int, Notification> */
    private function notificationsFor(FinancialControlAlert $alert): Collection
    {
        return Notification::query()
            ->where('tenant_id', $this->tenant->id)
            ->where('source_type', 'financial_control_alert')
            ->where('source_id', $alert->id)
            ->get();
    }

    /** @test */
    public function a_new_active_alert_delivers_one_notification_to_accounts_manage_holders(): void
    {
        $this->unbalancedEntry();
        $this->scan();

        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $notifications = $this->notificationsFor($alert);

        $this->assertCount(1, $notifications);
        $this->assertSame($this->owner->id, $notifications->first()->recipient_id);
        $this->assertSame('financial.alert_active', $notifications->first()->type);
        $this->assertSame('critical', $notifications->first()->severity);
        $this->assertSame('view_financial_alert', $notifications->first()->action);
    }

    /** @test */
    public function unchanged_repeated_scan_does_not_duplicate_the_notification(): void
    {
        $this->unbalancedEntry();
        $this->scan();
        $this->scan();
        $this->scan();

        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $this->assertCount(1, $this->notificationsFor($alert));
    }

    /** @test */
    public function reopening_a_resolved_alert_delivers_a_new_notification_but_resolving_delivers_none(): void
    {
        $entry = $this->unbalancedEntry();
        $this->scan();
        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $this->assertCount(1, $this->notificationsFor($alert));

        // تصحيح يدوي للفساد (كما لو أصلحه مطوّر) — التنبيه يُحلّ بلا إشعار جديد.
        JournalLine::where('journal_entry_id', $entry->id)->update(['credit' => 10000]);
        $this->scan();
        $this->assertSame('resolved', $alert->fresh()->status);
        $this->assertCount(1, $this->notificationsFor($alert));

        // يفسد مجدداً → دورة جديدة → إشعار جديد.
        JournalLine::where('journal_entry_id', $entry->id)->update(['credit' => 0]);
        $this->scan();
        $this->assertSame('active', $alert->fresh()->status);
        $this->assertCount(2, $this->notificationsFor($alert));
    }

    /** @test */
    public function tenant_isolation_keeps_alert_notifications_separate(): void
    {
        $this->unbalancedEntry();
        $this->scan();

        $tenantB = Tenant::create(['name' => 'مستأجر ب', 'slug' => 'controls-notif-b', 'vat_number' => '300000000000004', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        User::create(['tenant_id' => $tenantB->id, 'name' => 'مالك ب', 'email' => 'ownerb@controls-notif.test', 'password' => 'password123', 'role' => 'owner', 'is_active' => true]);
        Settings::put('finance', ['financial_alerts_enabled' => true], $tenantB);
        $this->unbalancedEntry('CTRL-BAD-B');
        $this->scan($tenantB->id);

        // سيناريو واحد فسادٌ مطابق حرفياً يُطلق أكثر من قاعدة (توازن القيد
        // وميزان المراجعة معاً) — العدد المطلق ليس ما نثبته هنا، بل تطابق
        // العدد بين المستأجرَين (نفس السيناريو) وغياب أي تسرّب بينهما.
        $countA = Notification::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->count();
        $countB = Notification::withoutGlobalScopes()->where('tenant_id', $tenantB->id)->count();
        $this->assertGreaterThan(0, $countA);
        $this->assertSame($countA, $countB);

        $alertIdsA = FinancialControlAlert::withoutGlobalScopes()->where('tenant_id', $this->tenant->id)->pluck('id');
        $leaked = Notification::withoutGlobalScopes()
            ->where('tenant_id', $tenantB->id)
            ->where('source_type', 'financial_control_alert')
            ->whereIn('source_id', $alertIdsA)
            ->count();
        $this->assertSame(0, $leaked);
    }

    /** @test */
    public function only_accounts_manage_holders_are_notified_not_broader_view_permissions(): void
    {
        $this->tokenForRole($this->tenant->id, 'staff', 'staff@controls-notif.test');
        $this->tokenForRole($this->tenant->id, 'accountant', 'accountant@controls-notif.test');
        $staff = User::where('email', 'staff@controls-notif.test')->first();
        $accountant = User::where('email', 'accountant@controls-notif.test')->first();
        app(TenantContext::class)->set($this->tenant->id);

        $this->unbalancedEntry();
        $this->scan();

        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $recipients = $this->notificationsFor($alert)->pluck('recipient_id')->all();

        $this->assertContains($this->owner->id, $recipients);
        // staff وaccountant يملكان reports.view/accounts.view لكن ليس accounts.manage —
        // نفس صلاحية الإقرار/التشغيل اليدوي القائمة على هذا المورد بالذات.
        $this->assertNotContains($staff->id, $recipients);
        $this->assertNotContains($accountant->id, $recipients);
    }

    /** @test */
    public function notification_read_state_never_touches_alert_acknowledgement_or_resolution(): void
    {
        $this->unbalancedEntry();
        $this->scan();
        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $notification = $this->notificationsFor($alert)->first();

        $notification->update(['read_at' => now()]);

        $this->assertSame('active', $alert->fresh()->status);
        $this->assertNull($alert->fresh()->acknowledged_at);
    }

    /** @test */
    public function the_bridge_never_mutates_accounting_records(): void
    {
        $entry = $this->unbalancedEntry();
        $before = [
            'entries' => JournalEntry::count(),
            'debit' => JournalLine::where('journal_entry_id', $entry->id)->sum('debit'),
            'credit' => JournalLine::where('journal_entry_id', $entry->id)->sum('credit'),
        ];

        $this->scan();

        $this->assertSame($before['entries'], JournalEntry::count());
        $this->assertSame($before['debit'], JournalLine::where('journal_entry_id', $entry->id)->sum('debit'));
        $this->assertSame($before['credit'], JournalLine::where('journal_entry_id', $entry->id)->sum('credit'));
    }

    /** @test */
    public function disabled_setting_delivers_no_notification(): void
    {
        Settings::put('finance', ['financial_alerts_enabled' => false], $this->tenant);
        $this->unbalancedEntry();

        $this->artisan('finance:scan-controls', ['--tenant' => $this->tenant->id])->assertSuccessful();

        $this->assertSame(0, FinancialControlAlert::count());
        $this->assertSame(0, Notification::where('tenant_id', $this->tenant->id)->count());
    }

    /** @test */
    public function force_scanning_a_disabled_tenant_never_notifies(): void
    {
        Settings::put('finance', ['financial_alerts_enabled' => false], $this->tenant);
        $this->unbalancedEntry();

        // يفحص فعلياً ويكتشف الفرق (force) لكنه يبقى بلا إشعار لأن الإعداد معطّل.
        $this->scan(force: true);

        $this->assertGreaterThan(0, FinancialControlAlert::count());
        $this->assertSame(0, Notification::where('tenant_id', $this->tenant->id)->count());
    }

    /** @test */
    public function the_scheduled_command_delivers_the_notification_end_to_end(): void
    {
        $this->unbalancedEntry();

        $this->scan();

        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $this->assertCount(1, $this->notificationsFor($alert));
    }

    /** @test */
    public function the_manual_run_check_endpoint_delivers_the_notification_end_to_end(): void
    {
        $this->unbalancedEntry();

        $this->withToken($this->owner->createToken('api')->plainTextToken)
            ->postJson('/api/financial-control-alerts/run-check')
            ->assertOk();

        $alert = FinancialControlAlert::where('rule', 'journal_unbalanced')->firstOrFail();
        $this->assertCount(1, $this->notificationsFor($alert));
    }
}

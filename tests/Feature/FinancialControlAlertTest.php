<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FinancialControlAlert;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FinancialControlService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تنبيهات الرقابة تكشف الفروق ولا تصلحها.
 *
 * تدخل الاختبارات بيانات فاسدة عمداً لمحاكاة ما قد يبقى من ترحيل قديم أو تدخل
 * خارج النظام؛ الإنتاج لا يسمح للمحرك بإنشاء قيد غير متوازن أصلاً.
 */
class FinancialControlAlertTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة الرقابة',
            'slug' => 'controls',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    private function unbalancedEntry(): JournalEntry
    {
        $entry = JournalEntry::create([
            'number' => 'CTRL-BAD-001',
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

    /** @test */
    public function financial_alerts_are_disabled_by_default_and_a_scan_is_a_no_op(): void
    {
        $this->unbalancedEntry();

        $result = app(FinancialControlService::class)->scan();

        $this->assertFalse($result['enabled']);
        $this->assertSame(0, $result['detected']);
        $this->assertSame(0, FinancialControlAlert::count());
    }

    /** @test */
    public function it_detects_an_unbalanced_posted_journal_without_altering_financial_records(): void
    {
        $entry = $this->unbalancedEntry();
        Settings::put('finance', ['financial_alerts_enabled' => true]);

        $before = [
            'entries' => JournalEntry::count(),
            'lines' => JournalLine::count(),
            'entry_status' => $entry->fresh()->status,
            'debit' => JournalLine::where('journal_entry_id', $entry->id)->sum('debit'),
            'credit' => JournalLine::where('journal_entry_id', $entry->id)->sum('credit'),
        ];

        $result = app(FinancialControlService::class)->scan();

        $this->assertTrue($result['enabled']);
        $this->assertGreaterThan(0, $result['detected']);
        $this->assertDatabaseHas('financial_control_alerts', [
            'tenant_id' => $this->tenant->id,
            'rule' => 'journal_unbalanced',
            'severity' => 'critical',
            'status' => 'active',
            'source_id' => $entry->id,
        ]);
        $this->assertSame($before['entries'], JournalEntry::count());
        $this->assertSame($before['lines'], JournalLine::count());
        $this->assertSame($before['entry_status'], $entry->fresh()->status);
        $this->assertSame($before['debit'], JournalLine::where('journal_entry_id', $entry->id)->sum('debit'));
        $this->assertSame($before['credit'], JournalLine::where('journal_entry_id', $entry->id)->sum('credit'));
    }

    /** @test */
    public function it_detects_a_posted_invoice_that_has_no_linked_journal_entry(): void
    {
        Settings::put('finance', ['financial_alerts_enabled' => true]);
        $partner = Partner::create(['name' => 'عميل الرقابة', 'type' => 'customer']);
        $invoice = Invoice::create([
            'number' => 'INV-CTRL-001',
            'partner_id' => $partner->id,
            'invoice_date' => now()->toDateString(),
            'status' => 'posted',
            'subtotal' => 10000,
            'tax_amount' => 0,
            'total' => 10000,
            'journal_entry_id' => null,
        ]);

        app(FinancialControlService::class)->scan();

        $this->assertDatabaseHas('financial_control_alerts', [
            'tenant_id' => $this->tenant->id,
            'rule' => 'posted_source_without_journal',
            'source_type' => Invoice::class,
            'source_id' => $invoice->id,
            'status' => 'active',
        ]);
    }

    /** @test */
    public function alerts_are_isolated_between_tenants(): void
    {
        Settings::put('finance', ['financial_alerts_enabled' => true]);
        $this->unbalancedEntry();
        app(FinancialControlService::class)->scan();
        $this->assertGreaterThan(0, FinancialControlAlert::count());

        $other = Tenant::create([
            'name' => 'شركة أخرى',
            'slug' => 'other-controls',
            'vat_number' => '300000000000004',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        Settings::put('finance', ['financial_alerts_enabled' => true]);

        $this->assertSame(0, FinancialControlAlert::count());
        $this->assertSame(0, app(FinancialControlService::class)->scan()['detected']);
    }

    /** @test */
    public function finance_settings_expose_safe_defaults_and_persist_the_control_policy(): void
    {
        $auth = $this->registerTenant('alert-settings', 'alerts@example.test');

        $defaults = $this->withToken($auth['token'])->getJson('/api/settings/finance')->assertOk()['data'];
        $this->assertFalse($defaults['financial_alerts_enabled']);
        $this->assertSame(1, $defaults['alert_check_window_days']);

        $updated = $this->withToken($auth['token'])->putJson('/api/settings/finance', [
            'financial_alerts_enabled' => true,
            'alert_check_window_days' => 14,
        ])->assertOk()['data'];

        $this->assertTrue($updated['financial_alerts_enabled']);
        $this->assertSame(14, $updated['alert_check_window_days']);
    }

    /** @test */
    public function the_report_check_window_is_applied_to_trial_balance_alert_details(): void
    {
        Settings::put('finance', [
            'financial_alerts_enabled' => true,
            'alert_check_window_days' => 7,
        ]);
        $this->unbalancedEntry();

        app(FinancialControlService::class)->scan();

        $alert = FinancialControlAlert::where('rule', 'trial_balance_unbalanced')->firstOrFail();
        $this->assertSame(now()->subDays(6)->toDateString(), $alert->details['period_from']);
        $this->assertSame(now()->toDateString(), $alert->details['period_to']);
    }

    /** @test */
    public function the_api_does_not_run_a_manual_check_when_alerts_are_disabled(): void
    {
        $auth = $this->registerTenant('manual-disabled', 'manual-disabled@example.test');

        $this->withToken($auth['token'])
            ->postJson('/api/financial-control-alerts/run-check')
            ->assertStatus(422)
            ->assertJsonPath('code', 'financial_alerts_disabled');
    }

    /** @test */
    public function viewing_alerts_is_read_only_while_acknowledgement_requires_accounts_management(): void
    {
        $auth = $this->registerTenant('alert-rbac', 'alert-rbac@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $alert = FinancialControlAlert::create([
            'fingerprint' => 'rbac-test-alert',
            'rule' => 'journal_unbalanced',
            'severity' => 'critical',
            'status' => 'active',
            'title' => 'تنبيه اختبار صلاحية',
            'description' => 'يجب أن يراه الموظف دون أن يقره.',
            'details' => [],
            'first_detected_at' => now(),
            'last_detected_at' => now(),
        ]);
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'alert-staff@example.test');

        $this->withToken($staffToken)->getJson('/api/financial-control-alerts')
            ->assertOk()
            ->assertJsonPath('data.0.id', $alert->id);
        $this->withToken($staffToken)->postJson("/api/financial-control-alerts/{$alert->id}/acknowledge")
            ->assertForbidden();

        $this->withToken($auth['token'])->postJson("/api/financial-control-alerts/{$alert->id}/acknowledge")
            ->assertOk()
            ->assertJsonPath('data.status', 'acknowledged');
    }

    /** @test */
    public function the_scheduled_command_reports_differences_but_completes_successfully(): void
    {
        Settings::put('finance', ['financial_alerts_enabled' => true]);
        $this->unbalancedEntry();

        $this->artisan('finance:scan-controls', ['--tenant' => $this->tenant->id])
            ->expectsOutputToContain('فرق مكتشف')
            ->assertSuccessful();

        $this->assertDatabaseHas('financial_control_alerts', [
            'tenant_id' => $this->tenant->id,
            'rule' => 'journal_unbalanced',
        ]);
    }
}

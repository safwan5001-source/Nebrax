<?php

namespace Tests\Feature;

use App\Models\FinancialControlAlert;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\FinancialControlService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class FinancialFuelAlertIsolationTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة عزل التنبيهات',
            'slug' => 'alert-isolation',
            'vat_number' => '300000000000031',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
    }

    /** @test */
    public function financial_scan_resolves_only_its_owned_rules_and_leaves_fuel_alerts_unchanged(): void
    {
        $fuel = $this->alert('fuel.device.stale:test', 'fuel.device.stale');
        $financial = $this->alert('journal_unbalanced:test', 'journal_unbalanced');

        $entriesBefore = JournalEntry::count();
        $linesBefore = JournalLine::count();

        $result = app(FinancialControlService::class)->scan(force: true);

        $this->assertSame('active', $fuel->fresh()->status);
        $this->assertNull($fuel->fresh()->resolved_at);
        $this->assertSame('resolved', $financial->fresh()->status);
        $this->assertNotNull($financial->fresh()->resolved_at);
        $this->assertSame(1, $result['resolved']);
        $this->assertSame(0, $result['active']);
        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame($linesBefore, JournalLine::count());
    }

    /** @test */
    public function financial_scan_does_not_mutate_fuel_alerts_belonging_to_another_tenant(): void
    {
        $other = Tenant::create([
            'name' => 'شركة أخرى',
            'slug' => 'alert-isolation-other',
            'vat_number' => '300000000000032',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($other->id);
        $otherFuel = $this->alert('fuel.device.stale:other', 'fuel.device.stale');

        app(TenantContext::class)->set($this->tenant->id);
        app(FinancialControlService::class)->scan(force: true);

        app(TenantContext::class)->set($other->id);
        $this->assertSame('active', $otherFuel->fresh()->status);
        $this->assertNull($otherFuel->fresh()->resolved_at);
    }

    private function alert(string $fingerprint, string $rule): FinancialControlAlert
    {
        return FinancialControlAlert::create([
            'fingerprint' => $fingerprint,
            'rule' => $rule,
            'severity' => 'critical',
            'status' => 'active',
            'title' => 'تنبيه اختبار',
            'description' => 'تنبيه لاختبار حدود ملكية دورة الحياة.',
            'details' => [],
            'first_detected_at' => now(),
            'last_detected_at' => now(),
        ]);
    }
}

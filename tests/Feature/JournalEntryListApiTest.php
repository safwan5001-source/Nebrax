<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\ManualJournal;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\LedgerService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * عقد القراءة فقط لسجل القيود: الفلاتر توسّع تجربة الاستكشاف، لكنها لا تتجاوز
 * TenantScope ولا نطاق الفرع المشتق من سطور القيد.
 */
class JournalEntryListApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedAccounts(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        if (! Account::exists()) {
            app(ChartOfAccountsSeeder::class)->seed($tenantId);
        }
    }

    private function postEntry(
        string $tenantId,
        ?string $branchId,
        string $date,
        string $description,
        int $amount,
        ?string $sourceType,
    ): void {
        app(TenantContext::class)->set($tenantId);
        app(BranchContext::class)->set($branchId);

        $cash = Account::where('code', '1110')->firstOrFail();
        $sales = Account::where('code', '4110')->firstOrFail();

        app(LedgerService::class)->post([
            ['account_id' => $cash->id, 'debit' => $amount],
            ['account_id' => $sales->id, 'credit' => $amount],
        ], [
            'entry_date' => $date,
            'description' => $description,
            'source_type' => $sourceType,
        ]);
    }

    /** @test */
    public function it_filters_and_paginates_visible_entries_without_weakening_branch_scope(): void
    {
        $auth = $this->registerTenant();
        $this->seedAccounts($auth['tenant_id']);
        $riyadh = Branch::create(['tenant_id' => $auth['tenant_id'], 'code' => '10001', 'name' => 'الرياض']);
        $jeddah = Branch::create(['tenant_id' => $auth['tenant_id'], 'code' => '10002', 'name' => 'جدة']);

        $this->postEntry($auth['tenant_id'], $riyadh->id, '2026-01-10', 'مطابقة فرع الرياض', 125000, ManualJournal::class);
        $this->postEntry($auth['tenant_id'], $jeddah->id, '2026-02-20', 'بيع فرع جدة', 250000, Invoice::class);

        $current = $this->withToken($auth['token'])
            ->withHeaders(['X-Branch-Id' => $riyadh->id])
            ->getJson('/api/journal-entries?per_page=10&search=%D8%A7%D9%84%D8%B1%D9%8A%D8%A7%D8%B6&entry_kind=manual&sort=total')
            ->assertOk()
            ->json();

        $this->assertSame(1, $current['meta']['total']);
        $this->assertSame(1, $current['meta']['current_page']);
        $this->assertSame(10, $current['meta']['per_page']);
        $this->assertCount(1, $current['data']);
        $this->assertSame('مطابقة فرع الرياض', $current['data'][0]['description']);
        $this->assertSame('1250.00', $current['data'][0]['total']);
        $this->assertSame('manual', $current['data'][0]['entry_kind']);

        $allAllowed = $this->withToken($auth['token'])
            ->withHeaders(['X-Branch-Id' => $riyadh->id])
            ->getJson('/api/journal-entries?branch=all&per_page=10&sort=-total&amount_min=2000')
            ->assertOk()
            ->json();

        $this->assertSame(1, $allAllowed['meta']['total']);
        $this->assertSame('بيع فرع جدة', $allAllowed['data'][0]['description']);
        $this->assertSame('automatic', $allAllowed['data'][0]['entry_kind']);
    }

    /** @test */
    public function it_returns_source_facets_from_the_full_visible_scope_not_only_the_loaded_page(): void
    {
        $auth = $this->registerTenant('journal-list-facets', 'journal-list-facets@example.test');
        $this->seedAccounts($auth['tenant_id']);

        for ($day = 1; $day <= 10; $day++) {
            $this->postEntry(
                $auth['tenant_id'],
                null,
                sprintf('2026-04-%02d', $day),
                "قيد يدوي {$day}",
                100000,
                ManualJournal::class,
            );
        }
        $this->postEntry($auth['tenant_id'], null, '2026-03-01', 'شراء في صفحة لاحقة', 100000, \App\Models\Purchase::class);

        $payload = $this->withToken($auth['token'])
            ->getJson('/api/journal-entries?per_page=10&sort=-entry_date')
            ->assertOk()
            ->json();

        $this->assertSame(11, $payload['meta']['total']);
        $this->assertCount(10, $payload['data']);
        $this->assertNotContains(\App\Models\Purchase::class, array_column($payload['data'], 'source_type'));
        $this->assertSame([ManualJournal::class, \App\Models\Purchase::class], $payload['facets']['source_types']);
    }

    /** @test */
    public function it_includes_source_less_non_reversal_entries_in_the_automatic_filter(): void
    {
        $auth = $this->registerTenant('journal-list-automatic', 'journal-list-automatic@example.test');
        $this->seedAccounts($auth['tenant_id']);
        $this->postEntry($auth['tenant_id'], null, '2026-04-01', 'قيد بلا مصدر', 100000, null);
        $this->postEntry($auth['tenant_id'], null, '2026-04-02', 'فاتورة آلية', 100000, Invoice::class);
        $this->postEntry($auth['tenant_id'], null, '2026-04-03', 'قيد يدوي', 100000, ManualJournal::class);

        $payload = $this->withToken($auth['token'])
            ->getJson('/api/journal-entries?per_page=10&entry_kind=automatic')
            ->assertOk()
            ->json();

        $this->assertSame(2, $payload['meta']['total']);
        $this->assertSame(['فاتورة آلية', 'قيد بلا مصدر'], array_column($payload['data'], 'description'));
        $this->assertSame(['automatic', 'automatic'], array_column($payload['data'], 'entry_kind'));
    }

    /** @test */
    public function it_rejects_scientific_notation_for_money_filters_instead_of_converting_it_incorrectly(): void
    {
        $auth = $this->registerTenant('journal-list-decimal', 'journal-list-decimal@example.test');

        $this->withToken($auth['token'])
            ->getJson('/api/journal-entries?per_page=10&amount_min=1.2e3')
            ->assertUnprocessable()
            ->assertJsonValidationErrors('amount_min');
    }

    /** @test */
    public function it_preserves_the_unpaginated_list_contract_for_existing_readers(): void
    {
        $auth = $this->registerTenant('journal-list-legacy', 'journal-list-legacy@example.test');
        $this->seedAccounts($auth['tenant_id']);
        $this->postEntry($auth['tenant_id'], null, '2026-03-01', 'قيد مركزي', 100000, Invoice::class);

        $payload = $this->withToken($auth['token'])
            ->getJson('/api/journal-entries')
            ->assertOk()
            ->json();

        $this->assertArrayNotHasKey('meta', $payload);
        $this->assertCount(1, $payload['data']);
        $this->assertSame('قيد مركزي', $payload['data'][0]['description']);
    }
}

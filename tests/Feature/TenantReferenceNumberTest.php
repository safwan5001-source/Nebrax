<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantReferenceNumberTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function administratorToken(array $abilities = ['platform:read', 'platform:manage']): string
    {
        $administrator = PlatformAdministrator::create([
            'name'     => 'مشغّل أرقام المستأجرين',
            'email'    => 'references+' . uniqid() . '@nebrax.test',
            'password' => 'platform-password-123',
        ]);

        return $administrator->createToken('tenant-references', $abilities)->plainTextToken;
    }

    /** @test */
    public function registration_assigns_distinct_human_readable_account_and_support_numbers(): void
    {
        $first = $this->postJson('/api/register', [
            'company_name' => 'شركة المراجع الأولى',
            'slug'         => 'references-first',
            'email'        => 'owner@references-first.test',
            'password'     => 'password123',
        ])->assertCreated();
        $second = $this->postJson('/api/register', [
            'company_name' => 'شركة المراجع الثانية',
            'slug'         => 'references-second',
            'email'        => 'owner@references-second.test',
            'password'     => 'password123',
        ])->assertCreated();

        $firstAccount = (string) $first->json('tenant.account_number');
        $firstSupport = (string) $first->json('tenant.support_number');
        $secondAccount = (string) $second->json('tenant.account_number');
        $secondSupport = (string) $second->json('tenant.support_number');

        $this->assertMatchesRegularExpression('/^\d{7}$/', $firstAccount);
        $this->assertMatchesRegularExpression('/^\d{4,6}$/', $firstSupport);
        $this->assertNotSame($firstAccount, $secondAccount);
        $this->assertNotSame($firstSupport, $secondSupport);
        $this->assertDatabaseHas('tenants', ['slug' => 'references-first', 'account_number' => $firstAccount, 'support_number' => $firstSupport]);
    }

    /** @test */
    public function references_are_preserved_after_soft_deletion_and_never_reused(): void
    {
        $first = $this->registerTenant('reference-deleted', 'owner@reference-deleted.test');
        $firstTenant = Tenant::findOrFail($first['tenant_id']);
        $firstAccount = $firstTenant->account_number;
        $firstSupport = $firstTenant->support_number;
        $firstTenant->delete();

        $second = $this->registerTenant('reference-replacement', 'owner@reference-replacement.test');
        $secondTenant = Tenant::findOrFail($second['tenant_id']);

        $this->assertNotSame($firstAccount, $secondTenant->account_number);
        $this->assertNotSame($firstSupport, $secondTenant->support_number);
        $this->assertGreaterThan($firstAccount, $secondTenant->account_number);
        $this->assertGreaterThan($firstSupport, $secondTenant->support_number);
    }

    /** @test */
    public function backfill_assigns_both_references_to_existing_tenants_in_a_stable_order(): void
    {
        /** @var \Illuminate\Database\Migrations\Migration $migration */
        $migration = require database_path('migrations/2025_01_01_000114_add_tenant_reference_numbers.php');
        $migration->down();

        $older = Tenant::create(['name' => 'شركة قديمة', 'slug' => 'legacy-older']);
        $older->forceFill(['created_at' => now()->subMinute()])->save();
        $newer = Tenant::create(['name' => 'شركة أحدث', 'slug' => 'legacy-newer']);

        $migration->up();

        $older->refresh();
        $newer->refresh();

        $this->assertMatchesRegularExpression('/^\d{7}$/', (string) $older->account_number);
        $this->assertMatchesRegularExpression('/^\d{4,6}$/', (string) $older->support_number);
        $this->assertNotSame($older->account_number, $newer->account_number);
        $this->assertNotSame($older->support_number, $newer->support_number);
        $this->assertLessThan($newer->account_number, $older->account_number);
        $this->assertLessThan($newer->support_number, $older->support_number);
    }

    /** @test */
    public function platform_admin_searches_exactly_by_either_reference_while_tenant_users_cannot_search_platform_records(): void
    {
        $alpha = $this->registerTenant('reference-alpha', 'owner@reference-alpha.test');
        $beta = $this->registerTenant('reference-beta', 'owner@reference-beta.test');
        $alphaTenant = Tenant::findOrFail($alpha['tenant_id']);
        $betaTenant = Tenant::findOrFail($beta['tenant_id']);
        $administratorToken = $this->administratorToken();

        $this->withToken($administratorToken)
            ->getJson('/api/platform/tenants?search=' . $alphaTenant->account_number)
            ->assertOk()
            ->assertJsonPath('pagination.total', 1)
            ->assertJsonPath('data.0.id', $alphaTenant->id)
            ->assertJsonPath('data.0.support_number', $alphaTenant->support_number);

        $this->withToken($administratorToken)
            ->getJson('/api/platform/tenants?search=' . $betaTenant->support_number)
            ->assertOk()
            ->assertJsonPath('pagination.total', 1)
            ->assertJsonPath('data.0.id', $betaTenant->id)
            ->assertJsonPath('data.0.account_number', $betaTenant->account_number);

        $this->withToken($alpha['token'])
            ->getJson('/api/platform/tenants?search=' . $betaTenant->support_number)
            ->assertForbidden();
    }

    /** @test */
    public function references_are_read_only_in_tenant_and_platform_update_contracts(): void
    {
        $tenant = $this->registerTenant('reference-immutable', 'owner@reference-immutable.test');
        $stored = Tenant::findOrFail($tenant['tenant_id']);
        $administratorToken = $this->administratorToken();

        $this->withToken($administratorToken)
            ->patchJson("/api/platform/tenants/{$stored->id}", [
                'account_number' => 7777777,
                'support_number' => 7777,
            ])
            ->assertStatus(422);

        $this->withToken($tenant['token'])
            ->getJson('/api/me')
            ->assertOk()
            ->assertJsonPath('company.account_number', $stored->account_number)
            ->assertJsonPath('company.support_number', $stored->support_number);

        $stored->refresh();
        $this->assertNotSame(7777777, $stored->account_number);
        $this->assertNotSame(7777, $stored->support_number);
    }
}

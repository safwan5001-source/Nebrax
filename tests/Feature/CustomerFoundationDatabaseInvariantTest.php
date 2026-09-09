<?php

namespace Tests\Feature;

use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class CustomerFoundationDatabaseInvariantTest extends TestCase
{
    use RefreshDatabase;

    public function test_database_rejects_cross_tenant_identity_partner_link(): void
    {
        $alpha = $this->tenant('db-alpha');
        $beta = $this->tenant('db-beta');
        $identity = $this->identity($alpha, 'db-alpha@example.test');
        $partner = $this->partner($beta, 'DB Foreign Partner');

        $this->expectException(QueryException::class);
        DB::table('customer_partner_links')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $alpha->id,
            'customer_identity_id' => $identity->id,
            'partner_id' => $partner->id,
            'status' => 'active',
            'link_method' => 'staff_verified_claim',
            'linked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_database_rejects_two_active_links_for_one_identity(): void
    {
        $tenant = $this->tenant('db-cardinality');
        $identity = $this->identity($tenant, 'db-cardinality@example.test');
        $first = $this->partner($tenant, 'First');
        $second = $this->partner($tenant, 'Second');
        $this->insertLink($tenant, $identity, $first);

        $this->expectException(QueryException::class);
        $this->insertLink($tenant, $identity, $second);
    }

    public function test_revoked_history_does_not_block_one_new_active_link(): void
    {
        $tenant = $this->tenant('db-revoked');
        $identity = $this->identity($tenant, 'db-revoked@example.test');
        $first = $this->partner($tenant, 'First');
        $second = $this->partner($tenant, 'Second');
        $firstLink = $this->insertLink($tenant, $identity, $first);
        DB::table('customer_partner_links')->where('id', $firstLink)->update([
            'status' => 'revoked',
            'revoked_at' => now(),
        ]);

        $this->insertLink($tenant, $identity, $second);

        $this->assertSame(1, DB::table('customer_partner_links')->where('status', 'active')->count());
        $this->assertSame(1, DB::table('customer_partner_links')->where('status', 'revoked')->count());
    }

    public function test_postgresql_has_concurrency_safe_partial_unique_index(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL catalog assertion.');
        }

        $definition = DB::table('pg_indexes')
            ->where('tablename', 'customer_partner_links')
            ->where('indexname', 'customer_partner_links_one_active_per_identity')
            ->value('indexdef');

        $this->assertIsString($definition);
        $this->assertStringContainsString('UNIQUE INDEX', $definition);
        $this->assertStringContainsString('WHERE', $definition);
        $this->assertStringContainsString('status', $definition);
        $this->assertStringContainsString('active', $definition);
    }

    private function tenant(string $slug): Tenant
    {
        return Tenant::create(['name' => $slug, 'slug' => $slug, 'is_active' => true]);
    }

    private function identity(Tenant $tenant, string $email): CustomerIdentity
    {
        return $this->withTenant($tenant, fn () => CustomerIdentity::create([
            'tenant_id' => $tenant->id,
            'display_name' => 'Customer',
            'email' => $email,
            'password' => 'password123',
            'email_verified_at' => now(),
        ]));
    }

    private function partner(Tenant $tenant, string $name): Partner
    {
        return $this->withTenant($tenant, fn () => Partner::create([
            'tenant_id' => $tenant->id,
            'name' => $name,
            'type' => 'customer',
        ]));
    }

    private function insertLink(Tenant $tenant, CustomerIdentity $identity, Partner $partner): string
    {
        $id = (string) Str::uuid();
        DB::table('customer_partner_links')->insert([
            'id' => $id,
            'tenant_id' => $tenant->id,
            'customer_identity_id' => $identity->id,
            'partner_id' => $partner->id,
            'status' => 'active',
            'link_method' => 'staff_verified_claim',
            'linked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $id;
    }

    private function withTenant(Tenant $tenant, callable $callback): mixed
    {
        $context = app(TenantContext::class);
        $context->set($tenant->id);

        try {
            return $callback();
        } finally {
            $context->forget();
        }
    }
}

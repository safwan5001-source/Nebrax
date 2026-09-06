<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\JournalLine;
use App\Models\Role;
use App\Models\User;
use App\Services\Accounting\AccountRoleMappingSeeder;
use App\Services\Accounting\AccountRoleResolver;
use App\Services\Accounting\AccountRoutingService;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * ACC-2 — Semantic Account Routing Foundation.
 * Clean Seeded Cutover: كل مستأجر معيَّن صراحةً لكل دور من لحظة التسجيل/الـbackfill.
 * لا Transitional Legacy Fallback — غياب/فساد التعيين الصريح فشلٌ مغلق دائماً.
 * تشغيل: php artisan test --filter=AccountRoutingTest
 */
class AccountRoutingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createCustomAccount(string $tenantId, string $code, bool $active = true, bool $group = false): Account
    {
        return Account::create([
            'tenant_id' => $tenantId,
            'code' => $code,
            'name' => 'حساب مخصص ' . $code,
            'type' => 'revenue',
            'normal_balance' => 'credit',
            'is_group' => $group,
            'is_active' => $active,
        ]);
    }

    /** @test */
    public function registration_seeds_an_explicit_mapping_for_every_catalog_role(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $seeded = AccountRoleMapping::query()->pluck('role_key')->sort()->values()->all();
        $expected = collect(AccountingRoles::keys())->sort()->values()->all();

        $this->assertSame($expected, $seeded);
    }

    /** @test */
    public function each_default_mapping_points_at_the_catalog_legacy_code_account(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        foreach (AccountingRoles::all() as $key => $meta) {
            $mapping = AccountRoleMapping::query()->where('role_key', $key)->first();
            $account = Account::query()->whereKey($mapping->account_id)->first();
            $this->assertSame($meta['legacy_code'], $account->code, "role {$key}");
        }
    }

    /** @test */
    public function seed_defaults_is_idempotent_and_never_overwrites_an_explicit_choice(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $custom = $this->createCustomAccount($auth['tenant_id'], '4199');
        app(AccountRoutingService::class)->setMapping('sales_revenue', $custom->id, null);

        // إعادة تشغيل الزرع — يجب ألا يطمس التخصيص ولا يكرر الصف.
        app(AccountRoleMappingSeeder::class)->seedDefaults($auth['tenant_id']);
        app(AccountRoleMappingSeeder::class)->seedDefaults($auth['tenant_id']);

        $mapping = AccountRoleMapping::query()->where('role_key', 'sales_revenue')->first();
        $this->assertSame($custom->id, $mapping->account_id);
        $this->assertSame(1, AccountRoleMapping::query()->where('role_key', 'sales_revenue')->count());
        $this->assertSame(count(AccountingRoles::keys()), AccountRoleMapping::query()->count());
    }

    /** @test */
    public function backfill_seeds_missing_mappings_for_a_pre_existing_tenant_without_touching_existing_ones(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        // يحاكي مستأجراً وُجد قبل ACC-2: بلا أي صفّ تعيين إطلاقاً.
        AccountRoleMapping::query()->delete();
        $this->assertSame(0, AccountRoleMapping::query()->count());

        app(AccountRoleMappingSeeder::class)->seedDefaults($auth['tenant_id']);

        $this->assertSame(count(AccountingRoles::keys()), AccountRoleMapping::query()->count());
        foreach (AccountingRoles::all() as $key => $meta) {
            $mapping = AccountRoleMapping::where('role_key', $key)->first();
            $this->assertNotNull($mapping, "role {$key}");
            $account = Account::whereKey($mapping->account_id)->first();
            $this->assertSame($meta['legacy_code'], $account->code);
        }
    }

    /** @test */
    public function tenant_a_cannot_map_or_see_tenant_b_accounts(): void
    {
        $a = $this->registerTenant('acme-a', 'owner-a@acme.test');
        $b = $this->registerTenant('acme-b', 'owner-b@acme.test');

        app(TenantContext::class)->set($b['tenant_id']);
        $bAccountId = AccountRoleMapping::query()->where('role_key', 'sales_revenue')->first()->account_id;

        // مستأجر A لا يستطيع تعيين دوره لمعرّف حساب يملكه مستأجر B.
        $this->withToken($a['token'])
            ->putJson('/api/accounting-settings/account-routing/sales_revenue', ['account_id' => $bAccountId])
            ->assertStatus(422);

        // ولا يظهر حساب B ضمن قائمة الحسابات المؤهلة لدى A.
        $res = $this->withToken($a['token'])->getJson('/api/accounting-settings/account-routing')->assertOk();
        $ids = collect($res->json('data.eligible_accounts'))->pluck('id')->all();
        $this->assertNotContains($bAccountId, $ids);
    }

    /** @test */
    public function tenant_a_cannot_read_tenant_b_routing_state(): void
    {
        $a = $this->registerTenant('acme-a2', 'owner-a2@acme.test');
        $b = $this->registerTenant('acme-b2', 'owner-b2@acme.test');

        app(TenantContext::class)->set($b['tenant_id']);
        $bCustom = $this->createCustomAccount($b['tenant_id'], '4197');
        app(AccountRoutingService::class)->setMapping('sales_revenue', $bCustom->id, null);

        $res = $this->withToken($a['token'])->getJson('/api/accounting-settings/account-routing')->assertOk();
        $role = collect($res->json('data.roles'))->firstWhere('key', 'sales_revenue');

        // A يرى تعيينه الافتراضي الخاص، لا حساب B المخصص إطلاقاً.
        $this->assertSame('4110', $role['mapping']['account']['code']);
    }

    /** @test */
    public function mapping_to_an_inactive_account_is_rejected(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $inactive = $this->createCustomAccount($auth['tenant_id'], '4196', active: false);

        $this->withToken($auth['token'])
            ->putJson('/api/accounting-settings/account-routing/sales_revenue', ['account_id' => $inactive->id])
            ->assertStatus(422);
    }

    /** @test */
    public function mapping_to_a_group_account_is_rejected(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $group = $this->createCustomAccount($auth['tenant_id'], '4195', group: true);

        $this->withToken($auth['token'])
            ->putJson('/api/accounting-settings/account-routing/sales_revenue', ['account_id' => $group->id])
            ->assertStatus(422);
    }

    /** @test */
    public function unknown_role_key_is_rejected_on_write_and_reset(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->putJson('/api/accounting-settings/account-routing/not_a_real_role', ['account_id' => (string) Str::uuid()])
            ->assertStatus(422);

        $this->withToken($auth['token'])
            ->deleteJson('/api/accounting-settings/account-routing/not_a_real_role')
            ->assertStatus(422);
    }

    /** @test */
    public function valid_mapping_resolves_the_selected_account(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4194');

        app(AccountRoutingService::class)->setMapping('sales_revenue', $custom->id, null);

        $resolved = app(AccountRoleResolver::class)->resolve('sales_revenue');
        $this->assertSame($custom->id, $resolved->id);
    }

    /** @test */
    public function resolver_fails_closed_when_no_explicit_mapping_exists_and_never_falls_back_to_the_legacy_code(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        // فجوة افتراضية (مثلاً دور أُضيف للكتالوج لاحقاً بلا backfill لهذا المستأجر بعد).
        AccountRoleMapping::query()->where('role_key', 'sales_revenue')->delete();

        $this->expectException(RuntimeException::class);
        app(AccountRoleResolver::class)->resolve('sales_revenue');
    }

    /** @test */
    public function an_explicit_mapping_that_later_becomes_invalid_fails_closed_without_silent_fallback(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4193');
        app(AccountRoutingService::class)->setMapping('sales_revenue', $custom->id, null);

        // الحساب المخصص يصبح غير نشط لاحقاً (على خلاف حسابات is_system المحصّنة).
        $custom->update(['is_active' => false]);

        $this->expectException(RuntimeException::class);
        app(AccountRoleResolver::class)->resolve('sales_revenue');
    }

    /** @test */
    public function invalid_mapping_is_surfaced_in_the_routing_list_not_silently_resolved(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4192');
        app(AccountRoutingService::class)->setMapping('cogs', $custom->id, null);
        $custom->update(['is_active' => false]);

        $res = $this->withToken($auth['token'])->getJson('/api/accounting-settings/account-routing')->assertOk();
        $role = collect($res->json('data.roles'))->firstWhere('key', 'cogs');

        $this->assertSame('invalid', $role['mapping']['state']);
    }

    /** @test */
    public function reset_writes_the_default_account_as_a_new_explicit_mapping_never_deletes_the_row(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4191');
        app(AccountRoutingService::class)->setMapping('sales_revenue', $custom->id, null);

        $this->withToken($auth['token'])
            ->deleteJson('/api/accounting-settings/account-routing/sales_revenue')
            ->assertOk();

        $mapping = AccountRoleMapping::query()->where('role_key', 'sales_revenue')->first();
        $this->assertNotNull($mapping);
        $default = Account::where('code', '4110')->first();
        $this->assertSame($default->id, $mapping->account_id);

        // المحلِّل يحل بلا استثناء بعد إعادة الضبط.
        $this->assertSame($default->id, app(AccountRoleResolver::class)->resolve('sales_revenue')->id);
    }

    /** @test */
    public function mapping_writes_create_an_immutable_audit_trail_with_before_after_snapshots(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4190');

        $this->withToken($auth['token'])
            ->putJson('/api/accounting-settings/account-routing/sales_revenue', ['account_id' => $custom->id])
            ->assertOk();

        $event = AccountRoleMappingEvent::query()->where('role_key', 'sales_revenue')->latest('created_at')->first();
        $this->assertSame('mapping_changed', $event->action);
        $this->assertNotNull($event->actor_user_id);
        $this->assertSame('4110', $event->previous_account_code);
        $this->assertSame('4190', $event->new_account_code);

        $this->expectException(LogicException::class);
        $event->update(['action' => 'mapping_created']);
    }

    /** @test */
    public function reset_records_a_mapping_reset_audit_event(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4189');
        app(AccountRoutingService::class)->setMapping('sales_revenue', $custom->id, null);

        $this->withToken($auth['token'])->deleteJson('/api/accounting-settings/account-routing/sales_revenue')->assertOk();

        $event = AccountRoleMappingEvent::query()->where('role_key', 'sales_revenue')->latest('created_at')->first();
        $this->assertSame('mapping_reset', $event->action);
        $this->assertSame('4189', $event->previous_account_code);
        $this->assertSame('4110', $event->new_account_code);
    }

    /** @test */
    public function unique_constraint_prevents_duplicate_mapping_rows_per_role(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->expectException(QueryException::class);
        AccountRoleMapping::create([
            'tenant_id' => $auth['tenant_id'],
            'role_key' => 'sales_revenue',
            'account_id' => Account::where('code', '4110')->first()->id,
        ]);
    }

    /** @test */
    public function accountant_and_staff_cannot_view_or_manage_account_routing_by_default(): void
    {
        $auth = $this->registerTenant();
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acc-routing@acme.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-routing@acme.test');

        $this->withToken($accountant)->getJson('/api/accounting-settings/account-routing')->assertStatus(403);
        $this->withToken($staff)->getJson('/api/accounting-settings/account-routing')->assertStatus(403);
    }

    /** @test */
    public function owner_can_view_and_manage_account_routing_via_wildcard(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $custom = $this->createCustomAccount($auth['tenant_id'], '4188');

        $this->withToken($auth['token'])->getJson('/api/accounting-settings/account-routing')->assertOk();
        $this->withToken($auth['token'])
            ->putJson('/api/accounting-settings/account-routing/sales_revenue', ['account_id' => $custom->id])
            ->assertOk();
    }

    /** @test */
    public function view_permission_alone_cannot_mutate_mappings(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        Role::create([
            'tenant_id' => $auth['tenant_id'],
            'slug' => 'routing_viewer',
            'name' => 'مراقب توجيه الحسابات',
            'permissions' => ['accounting_settings.view'],
            'is_system' => false,
        ]);
        $viewer = User::create([
            'tenant_id' => $auth['tenant_id'],
            'name' => 'مراقب',
            'email' => 'routing-viewer@acme.test',
            'password' => 'password123',
            'role' => 'routing_viewer',
        ]);
        $token = $viewer->createToken('api')->plainTextToken;

        $this->withToken($token)->getJson('/api/accounting-settings/account-routing')->assertOk();
        $this->withToken($token)->deleteJson('/api/accounting-settings/account-routing/sales_revenue')->assertStatus(403);
    }

    /** @test */
    public function mapping_writes_never_create_or_touch_journal_lines(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $before = JournalLine::query()->count();

        $custom = $this->createCustomAccount($auth['tenant_id'], '4187');
        app(AccountRoutingService::class)->setMapping('sales_revenue', $custom->id, null);
        app(AccountRoutingService::class)->reset('sales_revenue', null);

        $this->assertSame($before, JournalLine::query()->count());
    }

    /** @test */
    public function catalog_does_not_define_generic_cash_or_bank_roles(): void
    {
        foreach (AccountingRoles::keys() as $key) {
            $this->assertStringNotContainsString('cash', $key);
            $this->assertStringNotContainsString('bank', $key);
        }
    }
}

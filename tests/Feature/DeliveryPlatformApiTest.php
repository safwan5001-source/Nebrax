<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryPlatformProfileVersion;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\SalesChannel;
use App\Models\StockMovement;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * DLV-FOUNDATION-1 — واجهة إعداد منصات التوصيل: RBAC، عزل المستأجر والفرع،
 * عدم الكشف، والإعداد بلا أي أثر مالي.
 *
 * تشغيل: php artisan test --filter=DeliveryPlatformApiTest
 */
class DeliveryPlatformApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function owner(string $slug): array
    {
        return $this->registerTenant($slug, "owner@{$slug}.test");
    }

    private function create(string $token, array $body = []): array
    {
        return $this->withToken($token)->postJson('/api/delivery-platforms', array_merge(['platform_key' => 'keeta'], $body))
            ->assertCreated()->json('data');
    }

    private function branchOf(string $token, string $name = 'فرع إضافي'): string
    {
        return $this->withToken($token)->postJson('/api/branches', ['name' => $name])->assertCreated()['data']['id'];
    }

    /** @test */
    public function an_owner_creates_lists_shows_updates_and_resolves_a_platform_profile(): void
    {
        $auth = $this->owner('dlv-api-owner');
        $branch = $this->branchOf($auth['token']);

        $created = $this->create($auth['token'], [
            'collection_mode' => 'platform_collected',
            'external_reference_policy' => 'required',
            'branch_overrides' => [['branch_id' => $branch, 'external_reference_policy' => 'none']],
        ]);
        $this->assertSame('keeta', $created['platform_key']);
        $this->assertSame('external', $created['sales_channel']['type']);
        $this->assertSame('delivery-keeta', $created['sales_channel']['slug']);
        $this->assertSame(1, $created['current_version']['version_number']);
        $firstVersion = $created['current_version']['id'];
        $this->assertArrayNotHasKey('account_id', $created);

        $this->withToken($auth['token'])->getJson('/api/delivery-platforms')
            ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $created['id']);
        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$created['id']}")
            ->assertOk()->assertJsonPath('data.current_version.branch_overrides.0.branch_id', $branch);

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$created['id']}", [
            'collection_mode' => 'merchant_collected', 'change_reason' => 'تغيير العقد',
        ])->assertOk()->assertJsonPath('data.current_version.version_number', 2)
            ->assertJsonPath('data.current_version.collection_mode', 'merchant_collected');

        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$created['id']}/versions")
            ->assertOk()->assertJsonCount(2, 'data');

        // المسجَّل تاريخياً يبقى كما كان بعد التعديل.
        $this->withToken($auth['token'])
            ->getJson("/api/delivery-platforms/{$created['id']}/resolve?version_id={$firstVersion}&branch_id={$branch}")
            ->assertOk()
            ->assertJsonPath('data.collection_mode', 'platform_collected')
            ->assertJsonPath('data.external_reference_policy', 'none')
            ->assertJsonPath('data.branch_override_applied', true);
    }

    /** @test */
    public function the_catalog_lists_the_six_platforms_as_identity_only(): void
    {
        $auth = $this->owner('dlv-api-catalog');

        $data = $this->withToken($auth['token'])->getJson('/api/delivery-platforms/catalog')->assertOk()->json('data');

        $this->assertSame(
            ['hungerstation', 'keeta', 'jahez', 'mrsool', 'ninja', 'the_chefz'],
            array_column($data, 'platform_key')
        );
        $this->assertSame(['platform_key', 'name', 'name_en'], array_keys($data[0]));
    }

    /** @test */
    public function unauthenticated_requests_are_rejected(): void
    {
        $this->getJson('/api/delivery-platforms')->assertUnauthorized();
        $this->postJson('/api/delivery-platforms', ['platform_key' => 'keeta'])->assertUnauthorized();
    }

    /** @test */
    public function only_company_managers_can_mutate_but_viewers_can_read(): void
    {
        $auth = $this->owner('dlv-api-rbac');
        $created = $this->create($auth['token']);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@dlv-rbac.test');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acct@dlv-rbac.test');
        $selfService = $this->tokenForRole($auth['tenant_id'], 'self_service', 'ss@dlv-rbac.test');

        foreach ([$staff, $accountant] as $token) {
            $this->withToken($token)->getJson('/api/delivery-platforms')->assertOk();
            $this->withToken($token)->getJson("/api/delivery-platforms/{$created['id']}/versions")->assertOk();
            $this->withToken($token)->postJson('/api/delivery-platforms', ['platform_key' => 'jahez'])->assertForbidden();
            $this->withToken($token)->putJson("/api/delivery-platforms/{$created['id']}", ['collection_mode' => 'platform_collected'])
                ->assertForbidden();
        }
        $this->withToken($selfService)->getJson('/api/delivery-platforms')->assertForbidden();
        $this->withToken($selfService)->postJson('/api/delivery-platforms', ['platform_key' => 'jahez'])->assertForbidden();

        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$created['id']}/versions")
            ->assertOk()->assertJsonCount(1, 'data');
    }

    /** @test */
    public function a_second_tenant_cannot_see_modify_or_resolve_the_first_tenants_profile(): void
    {
        $a = $this->owner('dlv-api-iso-a');
        $b = $this->owner('dlv-api-iso-b');
        $profile = $this->create($a['token'], ['collection_mode' => 'platform_collected']);
        $version = $profile['current_version']['id'];

        $this->withToken($b['token'])->getJson('/api/delivery-platforms')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($b['token'])->getJson("/api/delivery-platforms/{$profile['id']}")->assertNotFound();
        $this->withToken($b['token'])->getJson("/api/delivery-platforms/{$profile['id']}/versions")->assertNotFound();
        $this->withToken($b['token'])->getJson("/api/delivery-platforms/{$profile['id']}/resolve?version_id={$version}")->assertNotFound();
        $this->withToken($b['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['collection_mode' => 'merchant_collected'])
            ->assertNotFound();

        // B ينشئ ملفه الخاص لنفس المنصة دون تأثير على A.
        $own = $this->create($b['token'], ['platform_key' => 'keeta']);
        $this->assertNotSame($profile['id'], $own['id']);
        $this->withToken($a['token'])->getJson("/api/delivery-platforms/{$profile['id']}")
            ->assertOk()->assertJsonPath('data.current_version.collection_mode', 'platform_collected');
        $this->withToken($a['token'])->getJson("/api/delivery-platforms/{$own['id']}")->assertNotFound();
    }

    /** @test */
    public function a_foreign_sales_channel_and_a_foreign_branch_are_rejected_without_revealing_existence(): void
    {
        $a = $this->owner('dlv-api-foreign-a');
        $b = $this->owner('dlv-api-foreign-b');

        app(TenantContext::class)->set($a['tenant_id']);
        $foreignChannel = SalesChannel::create(['slug' => 'delivery-keeta', 'name' => 'قناة A', 'type' => SalesChannel::TYPE_EXTERNAL]);
        $foreignBranch = $this->branchOf($a['token'], 'فرع A');
        app(TenantContext::class)->forget();

        $missing = '00000000-0000-4000-8000-000000000000';
        $viaForeign = $this->withToken($b['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'keeta', 'sales_channel_id' => $foreignChannel->id,
        ])->assertStatus(422)->json('message');
        $viaMissing = $this->withToken($b['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'keeta', 'sales_channel_id' => $missing,
        ])->assertStatus(422)->json('message');
        $this->assertSame($viaMissing, $viaForeign);

        $profile = $this->create($b['token']);
        $this->withToken($b['token'])->putJson("/api/delivery-platforms/{$profile['id']}", [
            'branch_overrides' => [['branch_id' => $foreignBranch, 'collection_mode' => 'platform_collected']],
        ])->assertStatus(422);
        $this->withToken($b['token'])->getJson("/api/delivery-platforms/{$profile['id']}")
            ->assertJsonPath('data.current_version.version_number', 1);
        $this->withToken($b['token'])->getJson("/api/delivery-platforms/{$profile['id']}/resolve?branch_id={$foreignBranch}")
            ->assertStatus(422);
    }

    /** @test */
    public function a_non_external_or_non_conventional_channel_is_rejected_over_http(): void
    {
        $auth = $this->owner('dlv-api-channel');
        app(TenantContext::class)->set($auth['tenant_id']);
        $web = SalesChannel::create(['slug' => 'delivery-keeta', 'name' => 'web', 'type' => SalesChannel::TYPE_WEB]);
        $reserved = SalesChannel::create(['slug' => 'web', 'name' => 'web2', 'type' => SalesChannel::TYPE_EXTERNAL]);
        app(TenantContext::class)->forget();

        // قناة web بسلاج المنصة: تصادم لا إعادة استخدام.
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'keeta'])->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'keeta', 'sales_channel_id' => $web->id])
            ->assertStatus(422);
        // سلاج محجوز.
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'jahez', 'sales_channel_id' => $reserved->id])
            ->assertStatus(422);

        $this->withToken($auth['token'])->getJson('/api/delivery-platforms')->assertJsonCount(0, 'data');
    }

    /** @test */
    public function input_validation_rejects_bad_enums_urls_and_immutable_identity_changes(): void
    {
        $auth = $this->owner('dlv-api-validate');
        $profile = $this->create($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'uber_eats'])->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'jahez', 'collection_mode' => 'cash'])->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'jahez', 'logo_asset_key' => 'https://evil.test/x.svg'])
            ->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'jahez', 'sales_channel_id' => 'not-a-uuid'])
            ->assertStatus(422);
        foreach (['../secret.svg', '/etc/passwd', 'a/../b.svg', 'javascript:alert(1)', 'a b.svg'] as $badKey) {
            $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'jahez', 'logo_asset_key' => $badKey])
                ->assertStatus(422);
        }

        foreach ([['platform_key' => 'jahez'], ['sales_channel_id' => '00000000-0000-4000-8000-000000000000']] as $forbidden) {
            $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", $forbidden)->assertStatus(422);
        }
        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['external_reference_policy' => 'sometimes'])
            ->assertStatus(422);

        // معرّف غير UUID لا يصل إلى قاعدة البيانات (PostgreSQL 22P02) بل 404.
        $this->withToken($auth['token'])->getJson('/api/delivery-platforms/not-a-uuid')->assertNotFound();
        $this->withToken($auth['token'])->putJson('/api/delivery-platforms/not-a-uuid', [])->assertNotFound();

        $this->assertSame(1, DeliveryPlatformProfileVersion::query()->withoutGlobalScopes()->count());
    }

    /** @test */
    public function null_fields_on_update_mean_unchanged_never_deactivate_or_clear_overrides(): void
    {
        $auth = $this->owner('dlv-api-null');
        $branch = $this->branchOf($auth['token']);
        $profile = $this->create($auth['token'], ['branch_overrides' => [['branch_id' => $branch, 'collection_mode' => 'platform_collected']]]);

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", [
            'is_active' => null, 'branch_overrides' => null, 'collection_mode' => null, 'external_reference_policy' => null,
        ])->assertOk()->assertJsonPath('data.current_version.version_number', 1)->assertJsonPath('data.is_active', true);

        // وإفراغ التجاوزات يحتاج [] صريحة.
        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['branch_overrides' => []])
            ->assertOk()->assertJsonPath('data.current_version.version_number', 2)
            ->assertJsonCount(0, 'data.current_version.branch_overrides');
    }

    /** @test */
    public function re_posting_a_platform_is_idempotent_unless_it_conflicts_and_a_noop_update_adds_no_version(): void
    {
        $auth = $this->owner('dlv-api-dup');
        $profile = $this->create($auth['token'], ['collection_mode' => 'platform_collected']);

        // إعادة محاولة بلا رأي أو بنفس القيم: 200 بنفس الملف، بلا نسخة جديدة.
        foreach ([['platform_key' => 'keeta'], ['platform_key' => 'keeta', 'collection_mode' => 'platform_collected', 'is_active' => true]] as $retry) {
            $this->withToken($auth['token'])->postJson('/api/delivery-platforms', $retry)
                ->assertOk()->assertJsonPath('data.id', $profile['id'])->assertJsonPath('data.current_version.version_number', 1);
        }
        // تعارض صريح: يُرفض ويُوجَّه إلى PUT، والإعداد القائم لا يتغيّر.
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'keeta', 'collection_mode' => 'merchant_collected'])
            ->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'keeta', 'is_active' => false])
            ->assertStatus(422);
        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}/versions")->assertJsonCount(1, 'data');
        $this->withToken($auth['token'])->getJson('/api/delivery-platforms')->assertJsonCount(1, 'data');

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['collection_mode' => 'platform_collected'])
            ->assertOk()->assertJsonPath('data.current_version.version_number', 1);
    }

    /** @test */
    public function the_versions_listing_resolves_the_branch_scope_once_not_per_version(): void
    {
        $auth = $this->owner('dlv-api-queries');
        $profile = $this->create($auth['token']);
        foreach (['platform_collected', 'merchant_collected', 'platform_collected'] as $mode) {
            $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['collection_mode' => $mode])->assertOk();
        }

        $count = 0;
        \Illuminate\Support\Facades\DB::listen(function ($q) use (&$count) {
            if (str_contains($q->sql, 'branch_user')) {
                $count++;
            }
        });
        $listing = function (string $query) use ($auth, $profile, &$count): int {
            $count = 0;
            $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}/versions?{$query}")->assertOk();

            return $count;
        };

        // عدد استعلامات نطاق الفروع لا يتناسب مع عدد النسخ في الصفحة.
        $this->assertSame($listing('per_page=1'), $listing('per_page=50'));
    }

    /** @test */
    public function a_branch_restricted_user_cannot_use_see_or_resolve_branches_outside_their_scope(): void
    {
        $auth = $this->owner('dlv-api-branch');
        $mine = $this->branchOf($auth['token'], 'فرعي');
        $theirs = $this->branchOf($auth['token'], 'فرع آخر');
        $profile = $this->create($auth['token'], ['branch_overrides' => [
            ['branch_id' => $mine, 'collection_mode' => 'platform_collected'],
            ['branch_id' => $theirs, 'external_reference_policy' => 'required'],
        ]]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $user = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'مدير فرع', 'email' => 'restricted@dlv-branch.test',
            'password' => 'password123', 'role' => 'admin',
        ]);
        $user->branches()->sync([$mine]);
        $token = $user->createToken('api')->plainTextToken;
        $headers = ['X-Branch-Id' => $mine];

        // التجاوز خارج النطاق: لا يُضبط ولا يُحلّ ولا يظهر.
        $this->withToken($token)->withHeaders($headers)->putJson("/api/delivery-platforms/{$profile['id']}", [
            'branch_overrides' => [['branch_id' => $theirs, 'collection_mode' => 'merchant_collected']],
        ])->assertStatus(422);
        $this->withToken($token)->withHeaders($headers)->getJson("/api/delivery-platforms/{$profile['id']}/resolve?branch_id={$theirs}")
            ->assertNotFound();
        $this->withToken($token)->withHeaders($headers)->getJson("/api/delivery-platforms/{$profile['id']}/resolve?branch_id={$mine}")
            ->assertOk()->assertJsonPath('data.collection_mode', 'platform_collected');

        $shown = $this->withToken($token)->withHeaders($headers)->getJson("/api/delivery-platforms/{$profile['id']}")
            ->assertOk()->json('data.current_version.branch_overrides');
        $this->assertSame([$mine], array_column($shown, 'branch_id'));

        // والمالك غير المقيَّد يرى الاثنين.
        $all = $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}")->json('data.current_version.branch_overrides');
        $this->assertEqualsCanonicalizing([$mine, $theirs], array_column($all, 'branch_id'));
        $this->assertNotNull(Branch::query()->find($theirs));
    }

    /** @test */
    public function a_branch_referenced_by_a_platform_override_cannot_be_deleted_and_returns_a_deliberate_422(): void
    {
        $auth = $this->owner('dlv-api-branchdel');
        $used = $this->branchOf($auth['token'], 'فرع مرجَع');
        $free = $this->branchOf($auth['token'], 'فرع حر');
        $this->create($auth['token'], ['branch_overrides' => [['branch_id' => $used, 'collection_mode' => 'platform_collected']]]);

        $this->withToken($auth['token'])->deleteJson("/api/branches/{$used}")->assertStatus(422);
        $this->withToken($auth['token'])->getJson('/api/branches')->assertJsonFragment(['id' => $used]);
        // الفرع غير المرتبط بتجاوز يُحذف كما كان.
        $this->withToken($auth['token'])->deleteJson("/api/branches/{$free}")->assertOk();
    }

    /** @test */
    public function summary_responses_carry_only_the_current_version_and_the_history_endpoint_is_paginated(): void
    {
        $auth = $this->owner('dlv-api-summary');
        $profile = $this->create($auth['token']);
        foreach (['platform_collected', 'merchant_collected', 'platform_collected'] as $mode) {
            $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['collection_mode' => $mode])->assertOk();
        }

        $this->withToken($auth['token'])->getJson('/api/delivery-platforms')
            ->assertOk()->assertJsonPath('data.0.current_version.version_number', 4);
        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}")
            ->assertOk()->assertJsonPath('data.current_version.version_number', 4)
            ->assertJsonPath('data.current_version.collection_mode', 'platform_collected');

        $page = $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}/versions?per_page=2")
            ->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.total', 4);
        $this->assertSame([1, 2], array_column($page->json('data'), 'version_number'));
        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}/versions?per_page=101")->assertStatus(422);
    }

    /** @test */
    public function a_disabled_pos_application_blocks_configuration_for_that_tenant(): void
    {
        $auth = $this->registerTenant('dlv-api-app', 'owner@dlv-api-app.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/delivery-platforms')->assertStatus(403);
        $this->withToken($auth['token'])->postJson('/api/delivery-platforms', ['platform_key' => 'keeta'])->assertStatus(403);
    }

    /** @test */
    public function configuration_endpoints_create_no_accounting_payment_inventory_or_payment_method_records(): void
    {
        $auth = $this->owner('dlv-api-nofin');
        app(TenantContext::class)->set($auth['tenant_id']);
        $before = [
            JournalEntry::count(), Invoice::count(), Payment::count(), StockMovement::count(), PaymentMethod::count(),
        ];
        app(TenantContext::class)->forget();

        $profile = $this->create($auth['token'], ['collection_mode' => 'platform_collected']);
        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", ['is_active' => false])->assertOk();
        $this->withToken($auth['token'])->getJson("/api/delivery-platforms/{$profile['id']}/resolve")->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame($before, [
            JournalEntry::count(), Invoice::count(), Payment::count(), StockMovement::count(), PaymentMethod::count(),
        ]);
    }
}

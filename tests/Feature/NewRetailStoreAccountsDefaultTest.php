<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\NewRetailChannelDefaults;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * B2C-DEFAULT — a NEWLY created retail (web) store starts with customer accounts ON; nothing else changes.
 *
 * The persisted per-channel flag is only a preference: the deployment gate (`commerce.retail_accounts_enabled`)
 * stays authoritative in RetailAccountGate, existing channels/stores are never touched, an explicit `false` is
 * respected, wholesale/external channels are unaffected, and no accounting/checkout/payment/ZATCA path is involved.
 */
class NewRetailStoreAccountsDefaultTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const FIRST = '/api/commerce/workspace/storefronts';

    private const ADDITIONAL = '/api/commerce/workspace/storefronts/create';

    private const SECRET = 'b2c-default-secret';

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'storefront.managed_base_domain' => 'store.awjdev.xyz',
            'storefront.gateway_secret' => self::SECRET,
            'commerce.retail_accounts_enabled' => true,
            'commerce.wholesale_buyer_enabled' => false,
        ]);
    }

    private function channel(string $id): SalesChannel
    {
        return SalesChannel::withoutGlobalScopes()->findOrFail($id);
    }

    /** Storefront-facing view of one store, resolved the way the real gateway does (Host + shared secret). */
    private function storefront(string $previewUrl)
    {
        $this->flushHeaders();

        return $this->withHeaders([
            'X-Storefront-Forwarded-Host' => (string) parse_url($previewUrl, PHP_URL_HOST),
            'X-Storefront-Gateway-Secret' => self::SECRET,
        ])->getJson('http://laravel-internal.test/store/v1/storefront');
    }

    private function register(string $host, string $previewUrl)
    {
        $this->flushHeaders();

        return $this->withHeaders([
            'X-Storefront-Forwarded-Host' => (string) parse_url($previewUrl, PHP_URL_HOST),
            'X-Storefront-Gateway-Secret' => self::SECRET,
        ])->postJson('http://laravel-internal.test/store/v1/auth/register', ['display_name' => 'x', 'email' => 'shopper@'.$host.'.test', 'password' => 'long-enough-1']);
    }

    /** A pre-existing web channel as every store looked BEFORE this change (column default). */
    private function legacyChannel(string $tenantId, bool $wholesale = false): SalesChannel
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::create(['slug' => 'legacy-'.Str::random(5), 'name' => 'Legacy', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        if ($wholesale) {
            $channel->forceFill(['wholesale_membership_enabled' => true])->save();
        }
        app(TenantContext::class)->forget();

        return $channel;
    }

    // ───────────────────────── المتجر الأول ─────────────────────────

    #[Test]
    public function a_new_first_store_defaults_to_customer_accounts_on_and_is_effective_when_the_gate_is_open(): void
    {
        $auth = $this->registerTenant('def-first', 'owner@def-first.test');

        $res = $this->withToken($auth['token'])->postJson(self::FIRST, ['name' => 'Roses'])->assertCreated();

        $this->assertTrue((bool) $this->channel($res->json('data.store.sales_channel_id'))->customer_accounts_enabled);
        $this->storefront($res->json('data.store.preview_url'))->assertOk()->assertJsonPath('data.capabilities.customer_accounts', true);
        $this->register('def-first', $res->json('data.store.preview_url'))->assertStatus(202); // neutral 202: registration is OPEN on this host (a closed host answers 404)
    }

    #[Test]
    public function an_explicit_false_on_the_first_store_is_respected_and_true_is_accepted(): void
    {
        $off = $this->registerTenant('def-off', 'owner@def-off.test');
        $res = $this->withToken($off['token'])->postJson(self::FIRST, ['customer_accounts_enabled' => false])->assertCreated();
        $this->assertFalse((bool) $this->channel($res->json('data.store.sales_channel_id'))->customer_accounts_enabled);
        $this->storefront($res->json('data.store.preview_url'))->assertOk()->assertJsonPath('data.capabilities.customer_accounts', false);
        $this->register('def-off', $res->json('data.store.preview_url'))->assertNotFound();

        $on = $this->registerTenant('def-on', 'owner@def-on.test');
        $res = $this->withToken($on['token'])->postJson(self::FIRST, ['customer_accounts_enabled' => true])->assertCreated();
        $this->assertTrue((bool) $this->channel($res->json('data.store.sales_channel_id'))->customer_accounts_enabled);
    }

    #[Test]
    public function re_provisioning_never_modifies_an_existing_channel(): void
    {
        $auth = $this->registerTenant('def-conv', 'owner@def-conv.test');
        $legacy = $this->legacyChannel($auth['tenant_id']);

        // The tenant already has an active web channel: provisioning converges to it, creates NO channel, changes NO flag.
        $res = $this->withToken($auth['token'])->postJson(self::FIRST, ['name' => 'Converge', 'customer_accounts_enabled' => true])->assertSuccessful();

        $this->assertSame($legacy->id, $res->json('data.store.sales_channel_id'));
        $this->assertFalse((bool) $this->channel($legacy->id)->customer_accounts_enabled);
        $this->assertSame(1, SalesChannel::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());

        // …and a repeat on a store that was itself created by this flow stays as it was after an explicit false.
        $other = $this->registerTenant('def-conv2', 'owner@def-conv2.test');
        $first = $this->withToken($other['token'])->postJson(self::FIRST, ['customer_accounts_enabled' => false])->assertCreated();
        $this->withToken($other['token'])->postJson(self::FIRST, [])->assertOk();
        $this->assertFalse((bool) $this->channel($first->json('data.store.sales_channel_id'))->customer_accounts_enabled);
    }

    // ───────────────────────── المتجر الإضافي ─────────────────────────

    #[Test]
    public function an_additional_store_defaults_on_and_does_not_touch_existing_stores(): void
    {
        $auth = $this->registerTenant('def-add', 'owner@def-add.test');
        $legacy = $this->legacyChannel($auth['tenant_id']);
        $legacyBefore = $this->channel($legacy->id)->only(['customer_accounts_enabled', 'wholesale_membership_enabled', 'is_active', 'slug', 'name', 'updated_at']);

        $res = $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'Gifts'])->assertCreated();
        $new = $this->channel($res->json('data.store.sales_channel_id'));

        $this->assertTrue((bool) $new->customer_accounts_enabled);
        $this->assertFalse((bool) $new->wholesale_membership_enabled); // never wholesale by default
        $this->assertSame(SalesChannel::TYPE_WEB, $new->type);
        $this->assertEquals($legacyBefore, $this->channel($legacy->id)->only(['customer_accounts_enabled', 'wholesale_membership_enabled', 'is_active', 'slug', 'name', 'updated_at']));
        $this->assertFalse((bool) $this->channel($legacy->id)->customer_accounts_enabled);
    }

    #[Test]
    public function an_explicit_false_on_an_additional_store_is_respected(): void
    {
        $auth = $this->registerTenant('def-add-off', 'owner@def-add-off.test');

        $res = $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'Quiet', 'customer_accounts_enabled' => false])->assertCreated();

        $this->assertFalse((bool) $this->channel($res->json('data.store.sales_channel_id'))->customer_accounts_enabled);
        $this->storefront($res->json('data.store.preview_url'))->assertOk()->assertJsonPath('data.capabilities.customer_accounts', false);
    }

    #[Test]
    public function the_global_gate_stays_authoritative_a_flagged_new_store_is_closed_while_the_gate_is_off(): void
    {
        config(['commerce.retail_accounts_enabled' => false]);
        $auth = $this->registerTenant('def-gate', 'owner@def-gate.test');

        $res = $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'Gated'])->assertCreated();

        // The preference is persisted ON, but there is NO effective access: every account route is closed.
        $this->assertTrue((bool) $this->channel($res->json('data.store.sales_channel_id'))->customer_accounts_enabled);
        $this->storefront($res->json('data.store.preview_url'))->assertOk()->assertJsonPath('data.capabilities.customer_accounts', false);
        $this->register('def-gate', $res->json('data.store.preview_url'))->assertNotFound();

        // Opening the gate later — with no per-store action — is what makes it effective (the deployment decision).
        config(['commerce.retail_accounts_enabled' => true]);
        $this->storefront($res->json('data.store.preview_url'))->assertOk()->assertJsonPath('data.capabilities.customer_accounts', true);
    }

    // ───────────────────────── الجملة والقنوات الأخرى ─────────────────────────

    #[Test]
    public function wholesale_marked_and_external_channels_are_not_touched_and_the_guard_still_holds(): void
    {
        $auth = $this->registerTenant('def-ws', 'owner@def-ws.test');
        $wholesale = $this->legacyChannel($auth['tenant_id'], wholesale: true);

        $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'Another'])->assertCreated();

        $reloaded = $this->channel($wholesale->id);
        $this->assertTrue((bool) $reloaded->wholesale_membership_enabled);
        $this->assertFalse((bool) $reloaded->customer_accounts_enabled);

        // A non-web channel keeps the column default, and the model guard still refuses retail accounts on it.
        app(TenantContext::class)->set($auth['tenant_id']);
        $external = SalesChannel::create(['slug' => 'ext-'.Str::random(5), 'name' => 'Ext', 'type' => SalesChannel::TYPE_EXTERNAL, 'is_active' => true]);
        $this->assertFalse((bool) $external->fresh()->customer_accounts_enabled);
        $this->expectException(DomainException::class);
        $external->forceFill(['customer_accounts_enabled' => true])->save();
    }

    #[Test]
    public function the_default_resolver_is_on_only_when_unspecified_and_only_the_two_creation_services_use_it(): void
    {
        $this->assertTrue(NewRetailChannelDefaults::initialCustomerAccountsEnabled(null));
        $this->assertTrue(NewRetailChannelDefaults::initialCustomerAccountsEnabled(true));
        $this->assertFalse(NewRetailChannelDefaults::initialCustomerAccountsEnabled(false));

        $users = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $file) {
            if ($file->isFile() && str_ends_with($file->getFilename(), '.php')
                && str_contains((string) file_get_contents($file->getPathname()), 'NewRetailChannelDefaults::createWebChannel')) {
                $users[] = $file->getFilename();
            }
        }
        sort($users);
        $this->assertSame(['CreateStorefrontForCurrentTenant.php', 'StorefrontProvisioningService.php'], $users);
    }

    #[Test]
    public function the_column_default_for_every_other_insert_path_is_unchanged(): void
    {
        $tenant = Tenant::create(['name' => 't', 'slug' => 'col-'.Str::random(5), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'plain', 'name' => 'Plain', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $this->assertFalse((bool) $channel->fresh()->customer_accounts_enabled);
    }

    // ───────────────────────── العزل والصلاحيات ─────────────────────────

    #[Test]
    public function client_supplied_tenant_ids_are_ignored_and_other_tenants_are_untouched(): void
    {
        $a = $this->registerTenant('def-iso-a', 'owner@def-iso-a.test');
        $b = $this->registerTenant('def-iso-b', 'owner@def-iso-b.test');
        $bChannel = $this->legacyChannel($b['tenant_id']);

        $res = $this->withToken($a['token'])->postJson(self::ADDITIONAL, ['name' => 'Mine', 'tenant_id' => $b['tenant_id'], 'sales_channel_id' => $bChannel->id])->assertCreated();

        $mine = $this->channel($res->json('data.store.sales_channel_id'));
        $this->assertSame($a['tenant_id'], $mine->tenant_id);
        $this->assertTrue((bool) $mine->customer_accounts_enabled);
        $this->assertFalse((bool) $this->channel($bChannel->id)->customer_accounts_enabled);
        $this->assertSame(1, SalesChannel::withoutGlobalScopes()->where('tenant_id', $b['tenant_id'])->count());
    }

    #[Test]
    public function unauthorised_callers_are_rejected_and_nothing_is_created(): void
    {
        $auth = $this->registerTenant('def-rbac', 'owner@def-rbac.test');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@def-rbac.test');
        $self = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@def-rbac.test');

        foreach ([self::FIRST, self::ADDITIONAL] as $path) {
            $this->withToken($staff)->postJson($path, ['name' => 'Staff'])->assertForbidden();
            $this->withToken($self)->postJson($path, ['name' => 'Self'])->assertForbidden();
            $this->postJson($path, ['name' => 'Guest'])->assertForbidden();
        }

        $this->assertSame(0, SalesChannel::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
        $this->assertSame(0, Storefront::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
    }

    #[Test]
    public function a_non_boolean_value_is_rejected_without_a_partial_graph(): void
    {
        $auth = $this->registerTenant('def-422', 'owner@def-422.test');

        $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'Bad', 'customer_accounts_enabled' => 'maybe'])->assertUnprocessable();
        $this->withToken($auth['token'])->postJson(self::FIRST, ['customer_accounts_enabled' => ['x']])->assertUnprocessable();

        $this->assertSame(0, SalesChannel::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
    }

    // ───────────────────────── الشاشة والمحاسبة ─────────────────────────

    #[Test]
    public function the_settings_endpoint_reads_the_real_persisted_value_and_still_saves_it(): void
    {
        $auth = $this->registerTenant('def-ui', 'owner@def-ui.test');
        $res = $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'Panel'])->assertCreated();
        $id = $res->json('data.store.sales_channel_id');
        $path = "/api/commerce/channels/{$id}/pricing-settings";

        $this->withToken($auth['token'])->getJson($path)->assertOk()
            ->assertJsonPath('data.customer_accounts_enabled', true)
            ->assertJsonPath('data.customer_accounts_deployment_enabled', true);

        $this->withToken($auth['token'])->putJson($path, ['customer_accounts_enabled' => false])->assertOk()->assertJsonPath('data.customer_accounts_enabled', false);
        $this->assertFalse((bool) $this->channel($id)->customer_accounts_enabled);
        $this->assertSame(1, SalesChannelSettingEvent::withoutGlobalScopes()->where('sales_channel_id', $id)->count()); // the user's change is audited
    }

    #[Test]
    public function creating_stores_posts_nothing_to_the_ledger(): void
    {
        $auth = $this->registerTenant('def-acct', 'owner@def-acct.test');
        $before = JournalEntry::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count();

        $this->withToken($auth['token'])->postJson(self::FIRST, ['name' => 'A'])->assertCreated();
        $this->withToken($auth['token'])->postJson(self::ADDITIONAL, ['name' => 'B'])->assertCreated();

        $this->assertSame($before, JournalEntry::withoutGlobalScopes()->where('tenant_id', $auth['tenant_id'])->count());
    }
}

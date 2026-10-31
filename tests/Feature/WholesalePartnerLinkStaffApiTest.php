<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Models\Partner;
use App\Models\PriceList;
use App\Models\Product;
use App\Models\Role;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Models\WholesaleMembership;
use App\Services\Commerce\WholesaleMembershipService;
use App\Services\PriceListService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch M (Phase 2) — ربط المشتري بالشريك من الموظف: الصلاحية، العزل، العلاقة الفعلية، التدقيق، وعدم تحكّم المشتري
 * ═══════════════════════════════════════════════════════════════
 */
class WholesalePartnerLinkStaffApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const SECRET = 'plink-secret';

    private const STORE = 'http://laravel-internal.test/store/v1/';

    private const HOST = 'plink.wholesale.test';

    private Tenant $tenant;

    private SalesChannel $channel;

    private Product $product;

    private PriceList $channelList;

    private PriceList $partnerList;

    private Partner $partner;

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => true, 'storefront.gateway_secret' => self::SECRET]);

        $this->tenant = Tenant::create(['name' => 'pl', 'slug' => 'pl-'.Str::random(8), 'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($this->tenant->id);
        $this->channel = SalesChannel::create(['slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $this->channel->forceFill(['wholesale_membership_enabled' => true])->save();
        $storefront = Storefront::create(['slug' => 's', 'name' => 'S', 'sales_channel_id' => $this->channel->id, 'is_active' => true]);
        StorefrontDomain::create(['storefront_id' => $storefront->id, 'hostname' => self::HOST, 'type' => StorefrontDomain::TYPE_CUSTOM, 'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED]);

        $this->product = Product::create(['name' => 'P', 'sku' => 'PL-1', 'unit' => 'piece', 'sale_price' => 1000, 'is_active' => true]);
        CommerceListing::create(['product_id' => $this->product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true]);
        $this->channelList = PriceList::create(['name' => 'ch', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($this->channelList, $this->product, ['price' => 700]);
        $this->channel->update(['default_price_list_id' => $this->channelList->id]);
        $this->partnerList = PriceList::create(['name' => 'pt', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($this->partnerList, $this->product, ['price' => 500]);
        $this->partner = Partner::create(['name' => 'شركة الأفق', 'code' => 'C-100', 'type' => 'customer', 'default_price_list_id' => $this->partnerList->id]);
        app(TenantContext::class)->forget();
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @return array{0: User, 1: string} */
    private function staff(Tenant $tenant, string $role = 'owner'): array
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => $role.'-user', 'email' => $role.'-'.Str::random(6).'@staff.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        $apps = app(TenantApplicationService::class);
        foreach (ApplicationCatalog::all() as $key => $app) {
            if (! $app['mandatory'] && $app['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                try {
                    $apps->enable($key, null);
                } catch (\Throwable) {
                }
            }
        }
        app(TenantContext::class)->forget();

        return [$user, $token];
    }

    /** @return array{0: CustomerIdentity, 1: WholesaleMembership} an identity with a membership in the given status */
    private function member(string $email, string $status = 'approved', ?Tenant $tenant = null): array
    {
        $tenant ??= $this->tenant;
        app(TenantContext::class)->set($tenant->id);
        $identity = CustomerIdentity::create(['tenant_id' => $tenant->id, 'display_name' => 'Buyer', 'email' => $email, 'password' => 'correct-horse-9', 'email_verified_at' => now(), 'is_active' => true]);
        $svc = app(WholesaleMembershipService::class);
        $m = $svc->apply($identity, $this->channel->id);
        $owner = User::query()->where('role', 'owner')->first() ?? User::create(['tenant_id' => $tenant->id, 'name' => 'o', 'email' => 'o-'.Str::random(6).'@s.test', 'password' => 'password123', 'role' => 'owner']);
        if ($status !== 'pending') {
            $svc->transition($m->id, 'approve', $owner);
            if ($status === 'suspended') {
                $svc->transition($m->id, 'suspend', $owner);
            }
        }
        $m = $m->refresh();
        app(TenantContext::class)->forget();

        return [$identity, $m];
    }

    private function url(string $membershipId): string
    {
        return "/api/commerce/wholesale/memberships/{$membershipId}/partner-link";
    }

    private function buyerPrice(string $email): ?int
    {
        $headers = ['X-Storefront-Forwarded-Host' => self::HOST, 'X-Storefront-Gateway-Secret' => self::SECRET];
        $token = (string) $this->withHeaders($headers)->postJson(self::STORE.'auth/login', ['email' => $email, 'password' => 'correct-horse-9'])->assertOk()->json('data.token');
        $rows = $this->withHeaders($headers + ['X-Customer-Token' => $token])->getJson(self::STORE.'products')->assertOk()->json('data');

        return $rows[0]['price']['amount_minor'] ?? null;
    }

    // ═══════════════════════ البوابة والصلاحيات ═══════════════════════

    #[Test]
    public function every_partner_link_route_is_a_uniform_404_while_the_deployment_flag_is_off(): void
    {
        [, $m] = $this->member('off@pl.test');
        [, $owner] = $this->staff($this->tenant);
        config(['commerce.wholesale_buyer_enabled' => false]);

        $this->withToken($owner)->getJson('/api/commerce/wholesale/partners/eligible')->assertNotFound();
        $this->withToken($owner)->getJson($this->url($m->id))->assertNotFound();
        $this->withToken($owner)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertNotFound();
        $this->withToken($owner)->deleteJson($this->url($m->id))->assertNotFound();
    }

    #[Test]
    public function the_routes_need_authentication_and_both_permissions(): void
    {
        [, $m] = $this->member('rbac@pl.test');
        $this->getJson($this->url($m->id))->assertUnauthorized();

        foreach (['accountant', 'staff'] as $role) {
            [, $t] = $this->staff($this->tenant, $role);
            $this->withToken($t)->getJson('/api/commerce/wholesale/partners/eligible')->assertForbidden();
            $this->withToken($t)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertForbidden();
            $this->withToken($t)->deleteJson($this->url($m->id))->assertForbidden();
        }

        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => 'wholesale_only', 'name' => 'جملة فقط', 'permissions' => ['commerce.wholesale.manage'], 'is_system' => false]);
        Role::create(['slug' => 'access_only', 'name' => 'وصول فقط', 'permissions' => ['customer_access.manage'], 'is_system' => false]);
        Role::create(['slug' => 'both', 'name' => 'كلاهما', 'permissions' => ['commerce.wholesale.manage', 'customer_access.manage'], 'is_system' => false]);
        app(TenantContext::class)->forget();

        // either permission alone is refused: the review permission cannot link, the access permission cannot see buyers
        foreach (['wholesale_only', 'access_only'] as $role) {
            [, $t] = $this->staff($this->tenant, $role);
            $this->withToken($t)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertForbidden();
        }
        [, $both] = $this->staff($this->tenant, 'both');
        $this->withToken($both)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk();
    }

    // ═══════════════════════ الربط وفكّه والعلاقة الفعلية ═══════════════════════

    #[Test]
    public function linking_changes_the_effective_list_and_the_buyers_price_and_unlinking_restores_the_channel_list(): void
    {
        [, $m] = $this->member('flow@pl.test');
        [$owner, $token] = $this->staff($this->tenant);

        $before = $this->withToken($token)->getJson($this->url($m->id))->assertOk()->json('data');
        $this->assertNull($before['active']);
        $this->assertSame('channel', $before['effective_price_list']['source']);
        $this->assertSame($this->channelList->id, $before['effective_price_list']['price_list']['id']);
        $this->assertSame(700, $this->buyerPrice('flow@pl.test'));

        $linked = $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk()->json('data');
        $this->assertSame($this->partner->id, $linked['active']['partner']['id']);
        $this->assertSame($owner->id, $linked['active']['linked_by']['id']);
        $this->assertSame('partner', $linked['effective_price_list']['source']);
        $this->assertSame($this->partnerList->id, $linked['effective_price_list']['price_list']['id']);
        $this->assertSame(500, $this->buyerPrice('flow@pl.test'));

        $unlinked = $this->withToken($token)->deleteJson($this->url($m->id))->assertOk()->json('data');
        $this->assertNull($unlinked['active']);
        $this->assertSame('channel', $unlinked['effective_price_list']['source']);
        $this->assertSame(700, $this->buyerPrice('flow@pl.test'));

        // audit trail: the revoked link is kept with who linked and who revoked it, and when
        $this->assertCount(1, $unlinked['history']);
        $row = $unlinked['history'][0];
        $this->assertSame('revoked', $row['status']);
        $this->assertSame($owner->id, $row['linked_by']['id']);
        $this->assertSame($owner->id, $row['revoked_by']['id']);
        $this->assertNotNull($row['linked_at']);
        $this->assertNotNull($row['revoked_at']);
    }

    #[Test]
    public function an_inactive_partner_list_is_reported_as_falling_back_to_the_channel_list(): void
    {
        [, $m] = $this->member('inactive@pl.test');
        [, $token] = $this->staff($this->tenant);
        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk();
        app(TenantContext::class)->set($this->tenant->id);
        $this->partnerList->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $shown = $this->withToken($token)->getJson($this->url($m->id))->assertOk()->json('data');
        $this->assertSame('channel', $shown['effective_price_list']['source']); // exactly what the pricing authority will use
        $this->assertNull($shown['effective_price_list']['partner_list']);
    }

    #[Test]
    public function relinking_is_idempotent_for_the_same_partner_and_refused_for_another_until_unlinked(): void
    {
        [, $m] = $this->member('idem@pl.test');
        [, $token] = $this->staff($this->tenant);
        app(TenantContext::class)->set($this->tenant->id);
        $other = Partner::create(['name' => 'ثانٍ', 'type' => 'customer']);
        app(TenantContext::class)->forget();

        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk();
        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk();
        $this->assertSame(1, CustomerPartnerLink::withoutGlobalScopes()->where('status', 'active')->count());

        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $other->id])->assertStatus(409)->assertJsonPath('reason', 'already_linked');
        $this->assertSame($this->partner->id, CustomerPartnerLink::withoutGlobalScopes()->where('status', 'active')->value('partner_id'));
    }

    #[Test]
    public function only_approved_buyers_can_be_linked_but_any_status_can_be_unlinked(): void
    {
        [, $pending] = $this->member('pending@pl.test', 'pending');
        [$suspendedIdentity, $suspended] = $this->member('susp@pl.test', 'approved');
        [, $token] = $this->staff($this->tenant);

        $this->withToken($token)->putJson($this->url($pending->id), ['partner_id' => $this->partner->id])->assertStatus(422)->assertJsonPath('reason', 'membership_not_approved');

        $this->withToken($token)->putJson($this->url($suspended->id), ['partner_id' => $this->partner->id])->assertOk();
        app(TenantContext::class)->set($this->tenant->id);
        app(WholesaleMembershipService::class)->transition($suspended->id, 'suspend', User::query()->where('role', 'owner')->firstOrFail());
        app(TenantContext::class)->forget();

        // a suspended buyer shows no effective list, and the special price can still be removed
        $shown = $this->withToken($token)->getJson($this->url($suspended->id))->assertOk()->json('data');
        $this->assertSame('none', $shown['effective_price_list']['source']);
        $this->withToken($token)->deleteJson($this->url($suspended->id))->assertOk()->assertJsonPath('data.active', null);
        $this->assertNotNull($suspendedIdentity->id);
    }

    #[Test]
    public function only_active_tenant_owned_customer_partners_are_eligible(): void
    {
        [, $m] = $this->member('elig@pl.test');
        [, $token] = $this->staff($this->tenant);

        app(TenantContext::class)->set($this->tenant->id);
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $inactive = Partner::create(['name' => 'معطل', 'type' => 'customer', 'is_active' => false]);
        $both = Partner::create(['name' => 'كلاهما', 'type' => 'both']);
        app(TenantContext::class)->forget();
        $foreignTenant = Tenant::create(['name' => 'f', 'slug' => 'f-'.Str::random(8), 'vat_number' => '300000000000004', 'currency' => 'SAR', 'is_active' => true]);
        app(TenantContext::class)->set($foreignTenant->id);
        $foreign = Partner::create(['name' => 'شركة الأفق الأجنبية', 'type' => 'customer']);
        app(TenantContext::class)->forget();

        $names = collect($this->withToken($token)->getJson('/api/commerce/wholesale/partners/eligible?limit=50')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($this->partner->id, $names);
        $this->assertContains($both->id, $names);
        foreach ([$supplier, $inactive, $foreign] as $bad) {
            $this->assertNotContains($bad->id, $names);
        }

        foreach ([$supplier, $inactive] as $bad) {
            $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $bad->id])->assertStatus(422)->assertJsonPath('reason', 'partner_not_eligible');
        }
        // another tenant's partner is indistinguishable from a missing one
        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $foreign->id])->assertNotFound()->assertJsonPath('reason', 'partner_not_found');
        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => (string) Str::uuid()])->assertNotFound();
        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => 'not-a-uuid'])->assertStatus(422);
        $this->assertSame(0, CustomerPartnerLink::withoutGlobalScopes()->count());
    }

    #[Test]
    public function the_partner_search_matches_name_and_code_and_treats_wildcards_literally(): void
    {
        [, $token] = $this->staff($this->tenant);

        $byName = $this->withToken($token)->getJson('/api/commerce/wholesale/partners/eligible?q='.urlencode('الأفق'))->assertOk()->json('data');
        $this->assertCount(1, $byName);
        $byCode = $this->withToken($token)->getJson('/api/commerce/wholesale/partners/eligible?q=C-100')->assertOk()->json('data');
        $this->assertSame($this->partner->id, $byCode[0]['id']);
        $this->assertSame([], $this->withToken($token)->getJson('/api/commerce/wholesale/partners/eligible?q='.urlencode('%'))->assertOk()->json('data'));
        $this->assertSame([], $this->withToken($token)->getJson('/api/commerce/wholesale/partners/eligible?q='.urlencode('_'))->assertOk()->json('data'));
        $this->assertArrayNotHasKey('credit_limit', $byName[0]);
        $this->assertArrayNotHasKey('vat_number', $byName[0]);
    }

    // ═══════════════════════ العزل والـIDOR ═══════════════════════

    #[Test]
    public function another_tenants_staff_cannot_see_link_or_unlink_this_tenants_buyer(): void
    {
        [, $m] = $this->member('iso@pl.test');
        [, $mine] = $this->staff($this->tenant);
        $this->withToken($mine)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk();

        $other = Tenant::create(['name' => 'o', 'slug' => 'o-'.Str::random(8), 'vat_number' => '300000000000005', 'currency' => 'SAR', 'is_active' => true]);
        [, $theirs] = $this->staff($other);

        $this->withToken($theirs)->getJson($this->url($m->id))->assertNotFound();
        $this->withToken($theirs)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertNotFound();
        $this->withToken($theirs)->deleteJson($this->url($m->id))->assertNotFound();
        $this->assertSame(1, CustomerPartnerLink::withoutGlobalScopes()->where('status', 'active')->count());

        $shown = $this->withToken($mine)->getJson('/api/commerce/wholesale/channels/'.$this->channel->id.'/memberships')->assertOk()->json('data');
        $this->assertSame($this->partner->id, $shown[0]['partner_link']['partner_id']);
    }

    #[Test]
    public function a_membership_on_a_non_wholesale_channel_cannot_be_linked(): void
    {
        [, $m] = $this->member('retail@pl.test');
        app(TenantContext::class)->set($this->tenant->id);
        $this->channel->forceFill(['wholesale_membership_enabled' => false])->save();
        app(TenantContext::class)->forget();
        [, $token] = $this->staff($this->tenant);

        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertNotFound();
    }

    #[Test]
    public function a_buyer_can_never_assign_a_partner_or_price_list_to_themselves(): void
    {
        [$identity, $m] = $this->member('self@pl.test');
        $headers = ['X-Storefront-Forwarded-Host' => self::HOST, 'X-Storefront-Gateway-Secret' => self::SECRET];
        $token = (string) $this->withHeaders($headers)->postJson(self::STORE.'auth/login', ['email' => 'self@pl.test', 'password' => 'correct-horse-9'])->json('data.token');
        $buyer = $headers + ['X-Customer-Token' => $token];

        // staff endpoints are unreachable with a buyer token (a different guard entirely)
        foreach ([
            $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id]),
            $this->withToken($token)->getJson('/api/commerce/wholesale/partners/eligible'),
        ] as $refused) {
            $this->assertContains($refused->getStatusCode(), [401, 403]); // refused either way; never a 2xx
        }

        // there is no buyer-facing route to link, and smuggled fields on the buyer's own writes are ignored/refused
        $this->withHeaders($buyer)->putJson(self::STORE.'wholesale/partner-link', ['partner_id' => $this->partner->id])->assertStatus(404);
        $this->withHeaders($buyer)->postJson(self::STORE.'wholesale/application', ['partner_id' => $this->partner->id, 'price_list_id' => $this->partnerList->id]);
        $this->assertSame(0, CustomerPartnerLink::withoutGlobalScopes()->count());
        $this->assertSame(700, $this->buyerPrice('self@pl.test'));
        $this->assertNotNull($identity->id);
    }

    #[Test]
    public function linking_never_touches_partner_or_price_list_data_or_pos_pricing(): void
    {
        [, $m] = $this->member('pos@pl.test');
        [, $token] = $this->staff($this->tenant);
        $partner = Partner::query()->withoutGlobalScopes()->find($this->partner->id)->getAttributes();
        $lists = PriceList::query()->withoutGlobalScopes()->orderBy('id')->get()->map->getAttributes()->all();
        $items = \DB::table('price_list_items')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all();

        $this->withToken($token)->putJson($this->url($m->id), ['partner_id' => $this->partner->id])->assertOk();
        $this->withToken($token)->deleteJson($this->url($m->id))->assertOk();

        $this->assertSame($partner, Partner::query()->withoutGlobalScopes()->find($this->partner->id)->getAttributes());
        $this->assertSame($lists, PriceList::query()->withoutGlobalScopes()->orderBy('id')->get()->map->getAttributes()->all());
        $this->assertSame($items, \DB::table('price_list_items')->orderBy('id')->get()->map(fn ($r) => (array) $r)->all());
    }
}

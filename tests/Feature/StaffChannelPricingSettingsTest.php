<?php

namespace Tests\Feature;

use App\Models\PriceList;
use App\Models\Role;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Models\User;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  H6 Batch F — إعدادات تسعير قناة الويب للموظف
 * ═══════════════════════════════════════════════════════════════
 *  صلاحية صريحة، بحث ضمن المستأجر لكلٍّ من القناة والقائمة، رفض المراجع الأجنبية، تدقيق (فاعل/وقت/قبل-بعد) للتغيير
 *  الفعلي وحده، ولا تفعيل ضمني: وسم الجملة يُرفض ما دامت بوابة النشر مغلقة، والإعداد وحده لا يفتح الجملة.
 */
class StaffChannelPricingSettingsTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private Tenant $tenant;

    private SalesChannel $channel;

    private string $owner;

    protected function setUp(): void
    {
        parent::setUp();
        config(['commerce.wholesale_buyer_enabled' => false]);
        ['tenant' => $this->tenant, 'channel' => $this->channel] = $this->makeTenant('alpha');
        [, $this->owner] = $this->staff($this->tenant);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel} */
    private function makeTenant(string $slug, string $type = SalesChannel::TYPE_WEB): array
    {
        $tenant = Tenant::create([
            'name' => $slug, 'slug' => $slug.'-'.Str::random(5),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web-'.Str::random(5), 'name' => 'Web', 'type' => $type, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return compact('tenant', 'channel');
    }

    /** @return array{0: User, 1: string} */
    private function staff(Tenant $tenant, string $role = 'owner'): array
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create([
            'tenant_id' => $tenant->id, 'name' => $role, 'email' => $role.'-'.Str::random(6).'@staff.test',
            'password' => 'password123', 'role' => $role,
        ]);
        $token = $user->createToken('api')->plainTextToken;
        $applications = app(TenantApplicationService::class);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                try {
                    $applications->enable($key, null);
                } catch (\Throwable) {
                    // already enabled
                }
            }
        }
        app(TenantContext::class)->forget();

        return [$user, $token];
    }

    private function priceList(Tenant $tenant, bool $active = true, string $name = 'List'): PriceList
    {
        app(TenantContext::class)->set($tenant->id);
        $list = PriceList::create(['name' => $name.' '.Str::random(5), 'is_active' => $active]);
        app(TenantContext::class)->forget();

        return $list;
    }

    private function putSettings(array $body, ?string $token = null, ?string $channelId = null)
    {
        return $this->withToken($token ?? $this->owner)
            ->putJson('/api/commerce/channels/'.($channelId ?? $this->channel->id).'/pricing-settings', $body);
    }

    private function fresh(?SalesChannel $channel = null): SalesChannel
    {
        $channel ??= $this->channel;

        return SalesChannel::withoutGlobalScopes()->findOrFail($channel->id);
    }

    private function events(?SalesChannel $channel = null)
    {
        return SalesChannelSettingEvent::withoutGlobalScopes()->where('sales_channel_id', ($channel ?? $this->channel)->id)->orderBy('created_at')->get();
    }

    // ═══════════════════════ RBAC ═══════════════════════

    #[Test]
    public function the_permission_is_explicit_owner_admin_only_and_never_in_the_matrix(): void
    {
        $this->assertContains('commerce.channel_settings.manage', Rbac::PERMISSIONS);
        foreach (Rbac::MATRIX as $role => $permissions) {
            if (! in_array('*', $permissions, true)) {
                $this->assertNotContains('commerce.channel_settings.manage', $permissions, "role {$role}");
            }
        }
        $this->assertTrue(Rbac::allows('owner', 'commerce.channel_settings.manage'));
        $this->assertTrue(Rbac::allows('admin', 'commerce.channel_settings.manage'));
        $this->assertFalse(Rbac::allows('accountant', 'commerce.channel_settings.manage'));
        $this->assertFalse(Rbac::allows('staff', 'commerce.channel_settings.manage'));
    }

    #[Test]
    public function unauthenticated_and_underprivileged_callers_are_refused_and_nothing_changes(): void
    {
        $list = $this->priceList($this->tenant);
        $url = '/api/commerce/channels/'.$this->channel->id.'/pricing-settings';

        $this->putJson($url, ['default_price_list_id' => $list->id])->assertUnauthorized();
        $this->getJson($url)->assertUnauthorized();

        foreach (['accountant', 'staff'] as $role) {
            [, $token] = $this->staff($this->tenant, $role);
            $this->putSettings(['default_price_list_id' => $list->id], $token)->assertForbidden();
            $this->withToken($token)->getJson($url)->assertForbidden();
        }

        // a stored custom role holding nearby permissions is still refused
        app(TenantContext::class)->set($this->tenant->id);
        Role::create(['slug' => 'near', 'name' => 'قريب', 'permissions' => ['commerce.manage', 'commerce.wholesale.manage', 'commerce.orders.view'], 'is_system' => false]);
        app(TenantContext::class)->forget();
        [, $custom] = $this->staff($this->tenant, 'near');
        $this->putSettings(['default_price_list_id' => $list->id], $custom)->assertForbidden();

        $this->assertNull($this->fresh()->default_price_list_id);
        $this->assertCount(0, $this->events());
    }

    // ═══════════════════════ التعيين والمسح ═══════════════════════

    #[Test]
    public function an_owner_can_assign_then_clear_a_price_list_with_an_audit_event_each_time(): void
    {
        $list = $this->priceList($this->tenant);

        $this->putSettings(['default_price_list_id' => $list->id])->assertOk()
            ->assertJsonPath('data.default_price_list.id', $list->id)
            ->assertJsonPath('data.wholesale_membership_enabled', false);
        $this->assertSame($list->id, $this->fresh()->default_price_list_id);

        $this->putSettings(['default_price_list_id' => null])->assertOk()->assertJsonPath('data.default_price_list', null);
        $this->assertNull($this->fresh()->default_price_list_id);

        $events = $this->events();
        $this->assertCount(2, $events);
        $this->assertSame(['default_price_list_id' => ['from' => null, 'to' => $list->id]], $events[0]->changes);
        $this->assertSame(['default_price_list_id' => ['from' => $list->id, 'to' => null]], $events[1]->changes);
        foreach ($events as $event) {
            $this->assertNotNull($event->created_at);
            $this->assertSame($this->tenant->id, $event->tenant_id);
            $this->assertSame('owner', User::withoutGlobalScopes()->findOrFail($event->actor_user_id)->role);
        }
    }

    #[Test]
    public function an_unchanged_request_writes_no_audit_event(): void
    {
        $list = $this->priceList($this->tenant);
        $this->putSettings(['default_price_list_id' => $list->id])->assertOk();
        $this->putSettings(['default_price_list_id' => $list->id])->assertOk();
        $this->putSettings(['wholesale_membership_enabled' => false])->assertOk();

        $this->assertCount(1, $this->events());
    }

    #[Test]
    public function a_foreign_inactive_or_unknown_price_list_is_refused_without_distinguishing_foreign_from_missing(): void
    {
        ['tenant' => $other] = $this->makeTenant('beta');
        $foreign = $this->priceList($other);
        $inactive = $this->priceList($this->tenant, false);

        $a = $this->putSettings(['default_price_list_id' => $foreign->id])->assertStatus(422);
        $b = $this->putSettings(['default_price_list_id' => (string) Str::uuid()])->assertStatus(422);
        $this->assertSame($a->json(), $b->json(), 'foreign and unknown are indistinguishable');
        $this->assertSame('price_list_not_found', $a->json('reason'));

        $this->putSettings(['default_price_list_id' => $inactive->id])->assertStatus(422)->assertJsonPath('reason', 'price_list_inactive');
        $this->putSettings(['default_price_list_id' => 'not-a-uuid'])->assertStatus(422);

        $this->assertNull($this->fresh()->default_price_list_id);
        $this->assertCount(0, $this->events());
    }

    #[Test]
    public function a_soft_deleted_price_list_cannot_be_assigned(): void
    {
        $list = $this->priceList($this->tenant);
        app(TenantContext::class)->set($this->tenant->id);
        $list->delete();
        app(TenantContext::class)->forget();

        $this->putSettings(['default_price_list_id' => $list->id])->assertStatus(422)->assertJsonPath('reason', 'price_list_not_found');
    }

    // ═══════════════════════ عزل المستأجر ═══════════════════════

    #[Test]
    public function another_tenants_channel_is_a_plain_404_and_a_client_tenant_id_is_rejected(): void
    {
        ['tenant' => $other, 'channel' => $otherChannel] = $this->makeTenant('gamma');
        $list = $this->priceList($this->tenant);

        $this->putSettings(['default_price_list_id' => $list->id], null, $otherChannel->id)->assertNotFound();
        $this->withToken($this->owner)->getJson('/api/commerce/channels/'.$otherChannel->id.'/pricing-settings')->assertNotFound();
        $this->putSettings(['default_price_list_id' => $list->id, 'tenant_id' => $other->id])->assertStatus(422);

        $this->assertNull($this->fresh($otherChannel)->default_price_list_id);
        $this->assertCount(0, $this->events($otherChannel));

        // and the other tenant's owner cannot see this tenant's channel either
        [, $otherOwner] = $this->staff($other);
        $this->withToken($otherOwner)->getJson('/api/commerce/channels/'.$this->channel->id.'/pricing-settings')->assertNotFound();
    }

    #[Test]
    public function only_web_channels_have_pricing_settings(): void
    {
        ['tenant' => $t, 'channel' => $pos] = $this->makeTenant('delta', SalesChannel::TYPE_POS);
        [, $token] = $this->staff($t);

        $this->withToken($token)->getJson('/api/commerce/channels/'.$pos->id.'/pricing-settings')->assertNotFound();
        $this->putSettings(['wholesale_membership_enabled' => true], $token, $pos->id)->assertStatus(422)->assertJsonPath('reason', 'channel_not_web');
        $this->assertFalse((bool) $this->fresh($pos)->wholesale_membership_enabled);
    }

    // ═══════════════════════ لا تفعيل ضمني ═══════════════════════

    #[Test]
    public function the_wholesale_flag_cannot_be_turned_on_while_the_deployment_gate_is_off(): void
    {
        $this->putSettings(['wholesale_membership_enabled' => true])->assertStatus(409)
            ->assertJsonPath('reason', 'wholesale_deployment_disabled');
        $this->assertFalse((bool) $this->fresh()->wholesale_membership_enabled);
        $this->assertCount(0, $this->events());
    }

    #[Test]
    public function with_the_gate_on_the_flag_is_audited_and_turning_it_off_is_always_allowed(): void
    {
        config(['commerce.wholesale_buyer_enabled' => true]);
        $this->putSettings(['wholesale_membership_enabled' => true])->assertOk()
            ->assertJsonPath('data.wholesale_membership_enabled', true)
            ->assertJsonPath('data.wholesale_deployment_enabled', true);

        config(['commerce.wholesale_buyer_enabled' => false]);
        $this->putSettings(['wholesale_membership_enabled' => false])->assertOk()->assertJsonPath('data.wholesale_membership_enabled', false);

        $events = $this->events();
        $this->assertCount(2, $events);
        $this->assertSame(['wholesale_membership_enabled' => ['from' => false, 'to' => true]], $events[0]->changes);
        $this->assertSame(['wholesale_membership_enabled' => ['from' => true, 'to' => false]], $events[1]->changes);
    }

    #[Test]
    public function an_empty_or_unknown_payload_changes_nothing(): void
    {
        $this->putSettings([])->assertStatus(422)->assertJsonPath('reason', 'no_changes_supplied');
        $this->putSettings(['is_active' => false, 'name' => 'x', 'type' => 'pos'])->assertStatus(422);

        $channel = $this->fresh();
        $this->assertSame('web', $channel->type);
        $this->assertSame('Web', $channel->name);
        $this->assertTrue((bool) $channel->is_active);
        $this->assertCount(0, $this->events());
    }

    #[Test]
    public function configuration_alone_does_not_open_wholesale_to_the_public_gate(): void
    {
        // Flag on + list assigned, deployment gate then closed again → the storefront price gate is dark (404), not public.
        config(['commerce.wholesale_buyer_enabled' => true]);
        $list = $this->priceList($this->tenant);
        $this->putSettings(['default_price_list_id' => $list->id, 'wholesale_membership_enabled' => true])->assertOk();
        config(['commerce.wholesale_buyer_enabled' => false]);

        app(TenantContext::class)->set($this->tenant->id);
        $storefront = Storefront::create(['slug' => 's', 'name' => 'Main', 'sales_channel_id' => $this->channel->id, 'is_active' => true]);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'cfg.settings.test', 'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true, 'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $this->getJson('http://cfg.settings.test/store/v1/products')->assertNotFound();
    }

    // ═══════════════════════ التدقيق ═══════════════════════

    #[Test]
    public function audit_events_are_immutable(): void
    {
        $list = $this->priceList($this->tenant);
        $this->putSettings(['default_price_list_id' => $list->id])->assertOk();
        $event = $this->events()->first();

        app(TenantContext::class)->set($this->tenant->id);
        try {
            $event->update(['changes' => []]);
            $this->fail('update must be refused');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        try {
            $event->delete();
            $this->fail('delete must be refused');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function show_returns_the_current_settings_and_recent_history_without_internals(): void
    {
        $list = $this->priceList($this->tenant);
        $this->putSettings(['default_price_list_id' => $list->id])->assertOk();

        $response = $this->withToken($this->owner)->getJson('/api/commerce/channels/'.$this->channel->id.'/pricing-settings')->assertOk();
        $response->assertJsonPath('data.default_price_list.id', $list->id)
            ->assertJsonPath('data.recent_changes.0.changes.default_price_list_id.to', $list->id)
            ->assertJsonPath('data.recent_changes.0.actor.name', 'owner');
        $this->assertArrayNotHasKey('tenant_id', $response->json('data'));
    }

    #[Test]
    public function the_model_guard_still_rejects_wholesale_on_a_non_web_channel_directly(): void
    {
        ['tenant' => $t, 'channel' => $pos] = $this->makeTenant('eps', SalesChannel::TYPE_POS);
        app(TenantContext::class)->set($t->id);
        $this->expectException(DomainException::class);
        $pos->forceFill(['wholesale_membership_enabled' => true])->save();
    }
}

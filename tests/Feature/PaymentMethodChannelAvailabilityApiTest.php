<?php

namespace Tests\Feature;

use App\Models\PaymentMethod;
use App\Models\PaymentMethodChannelAvailability;
use App\Models\SalesChannel;
use App\Models\SalesChannelSettingEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Services\PaymentMethodChannelAvailabilityService;
use App\Services\TenantApplicationService;
use App\Support\ApplicationCatalog;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * COPS-H4-6 (D-H4-06) — إتاحة طريقة دفع لكل قناة Commerce: `GET|PUT payment-methods/{id}/channel-availability[/{channelId}]`.
 * يُثبت: الصلاحيتان معاً (المدفوعات + التجارة) وقدرة المتجر؛ الافتراضي `available_online`؛ تجاوز صريح ثم إزالته؛ التدقيق لتغيير فعلي فقط؛ POS خارج النطاق؛
 * العزل؛ وأن Checkout المتجر يقرأ النتيجة نفسها (مصدر واحد للإتاحة).
 */
class PaymentMethodChannelAvailabilityApiTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->bootOnlineStore();
        $this->enableApplications($this->tenant);
        $this->ownerToken = $this->tokenFor($this->tenant, 'owner');
    }

    private function enableApplications(Tenant $tenant): void
    {
        app(TenantContext::class)->set($tenant->id);
        foreach (ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === ApplicationCatalog::MATURITY_BUILT) {
                app(TenantApplicationService::class)->enable($key, null);
            }
        }
        app(TenantContext::class)->forget();
    }

    private function tokenFor(Tenant $tenant, string $role): string
    {
        app(TenantContext::class)->set($tenant->id);
        $user = User::create(['tenant_id' => $tenant->id, 'name' => 'مستخدم '.$role, 'email' => $role.'-'.Str::random(6).'@pma.test', 'password' => 'password123', 'role' => $role]);
        $token = $user->createToken('api')->plainTextToken;
        app(TenantContext::class)->forget();

        return $token;
    }

    private function url(?string $methodId = null, ?string $channelId = null): string
    {
        return '/api/payment-methods/'.($methodId ?? $this->method->id).'/channel-availability'.($channelId === null ? '' : '/'.$channelId);
    }

    private function listAvail(?string $methodId = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->getJson($this->url($methodId));
    }

    private function setAvail(?bool $enabled, ?string $channelId = null, ?string $methodId = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->ownerToken)->putJson($this->url($methodId, $channelId ?? $this->channel->id), ['is_enabled' => $enabled]);
    }

    private function events(): array
    {
        return SalesChannelSettingEvent::query()->withoutGlobalScopes()->get()->map(fn ($e) => $e->changes)->all();
    }

    private function checkoutMethodIds(string $token): array
    {
        return collect($this->api(self::HOST, $token)->getJson(self::BASE.'/checkout/payment-methods')->assertOk()->json('data.payment_methods'))->pluck('id')->all();
    }

    #[Test]
    public function the_list_shows_every_non_pos_channel_with_its_override_and_effective_state(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        SalesChannel::create(['slug' => 'mob', 'name' => 'Mobile', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        SalesChannel::create(['slug' => 'pos', 'name' => 'POS', 'type' => SalesChannel::TYPE_POS, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $response = $this->listAvail()->assertOk();
        $response->assertJsonPath('data.payment_method.id', $this->method->id)->assertJsonPath('data.payment_method.available_online', true);
        $types = collect($response->json('data.channels'))->pluck('type')->sort()->values()->all();
        $this->assertSame(['mobile', 'web'], $types, 'POS خارج النطاق');
        $web = collect($response->json('data.channels'))->firstWhere('sales_channel_id', $this->channel->id);
        $this->assertTrue($web['override'], 'الاختبار يهيّئ تجاوزاً صريحاً true لقناة الويب');
        $this->assertTrue($web['effective']);
        $mobile = collect($response->json('data.channels'))->firstWhere('type', 'mobile');
        $this->assertNull($mobile['override']);
        $this->assertTrue($mobile['effective'], 'بلا تجاوز ⇒ available_online (true)');
    }

    #[Test]
    public function disabling_hides_the_method_from_the_storefront_checkout_and_resetting_returns_the_default(): void
    {
        $token = $this->readyCheckout($this->product($this->tenant, $this->channel), null);
        $this->assertContains($this->method->id, $this->checkoutMethodIds($token));

        $this->setAvail(false)->assertOk()->assertJsonPath('data.override', false)->assertJsonPath('data.effective', false);
        $this->assertNotContains($this->method->id, $this->checkoutMethodIds($token), 'Checkout المتجر يقرأ الإتاحة نفسها');
        app(TenantContext::class)->set($this->tenant->id);
        $this->assertFalse(app(PaymentMethodChannelAvailabilityService::class)->isAvailable($this->method, $this->channel));
        app(TenantContext::class)->forget();

        $this->setAvail(null)->assertOk()->assertJsonPath('data.override', null)->assertJsonPath('data.effective', true);
        $this->assertContains($this->method->id, $this->checkoutMethodIds($token));
        $this->assertSame(0, PaymentMethodChannelAvailability::query()->withoutGlobalScopes()->where('payment_method_id', $this->method->id)->count(), 'الإزالة تحذف التجاوز');
    }

    #[Test]
    public function a_method_not_available_online_is_off_by_default_and_an_explicit_enable_overrides_it(): void
    {
        app(TenantContext::class)->set($this->tenant->id);
        $cash = PaymentMethod::create(['name' => 'نقدي', 'settlement_type' => 'cash', 'available_online' => false]);
        app(TenantContext::class)->forget();

        $row = collect($this->listAvail($cash->id)->assertOk()->json('data.channels'))->firstWhere('sales_channel_id', $this->channel->id);
        $this->assertNull($row['override']);
        $this->assertFalse($row['effective']);

        $this->setAvail(true, null, $cash->id)->assertOk()->assertJsonPath('data.effective', true);
        $this->setAvail(null, null, $cash->id)->assertOk()->assertJsonPath('data.effective', false);
    }

    #[Test]
    public function only_a_real_change_is_audited_with_the_prefixed_key_and_a_repeat_is_silent(): void
    {
        $this->setAvail(false)->assertOk();
        $this->setAvail(false)->assertOk();
        $this->assertCount(1, $this->events());
        $key = 'payment_methods.'.$this->method->id.'.channel_availability';
        $this->assertSame([$key => ['from' => true, 'to' => false]], $this->events()[0]);

        $this->setAvail(null)->assertOk();
        $this->setAvail(null)->assertOk();
        $this->assertCount(2, $this->events());
        $this->assertSame([$key => ['from' => false, 'to' => null]], $this->events()[1]);
    }

    #[Test]
    public function both_permissions_are_required_to_read_or_write_and_the_application_gate_applies(): void
    {
        // accountant يملك payments.manage لكن لا commerce.channel_settings.manage؛ staff لا يملك أياً منهما.
        foreach (['accountant', 'staff'] as $role) {
            $token = $this->tokenFor($this->tenant, $role);
            $this->listAvail(null, $token)->assertForbidden();
            $this->setAvail(false, null, null, $token)->assertForbidden();
        }
        $this->assertCount(0, $this->events());

        $this->setAvail(false, null, null, $this->tokenFor($this->tenant, 'admin'))->assertOk();

        app(TenantContext::class)->set($this->tenant->id);
        app(TenantApplicationService::class)->disable('commerce.storefront', User::query()->first());
        app(TenantContext::class)->forget();
        $this->listAvail()->assertForbidden();
        $this->setAvail(true)->assertForbidden();
    }

    #[Test]
    public function the_body_is_strict_and_a_pos_channel_is_not_supported(): void
    {
        $url = $this->url(null, $this->channel->id);
        $this->withToken($this->ownerToken)->putJson($url, [])->assertStatus(422);
        $this->withToken($this->ownerToken)->putJson($url, ['is_enabled' => 'maybe'])->assertStatus(422);
        $this->withToken($this->ownerToken)->putJson($url, ['is_enabled' => true, 'tenant_id' => (string) Str::uuid()])->assertStatus(422);

        app(TenantContext::class)->set($this->tenant->id);
        $pos = SalesChannel::create(['slug' => 'pos2', 'name' => 'POS', 'type' => SalesChannel::TYPE_POS, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $this->setAvail(false, $pos->id)->assertStatus(422)->assertJsonPath('reason', 'channel_not_supported');
        $this->assertSame(0, PaymentMethodChannelAvailability::query()->withoutGlobalScopes()->where('sales_channel_id', $pos->id)->count());
    }

    #[Test]
    public function another_tenants_method_or_channel_is_indistinguishable_not_found_and_nothing_is_written(): void
    {
        ['tenant' => $other, 'channel' => $otherChannel] = $this->makeStore('pma-other.test', 'pma-other');
        [$otherMethod] = $this->wirePayments($other, $otherChannel);
        $this->enableApplications($other);
        $otherToken = $this->tokenFor($other, 'owner');
        $before = PaymentMethodChannelAvailability::query()->withoutGlobalScopes()->count();

        $this->listAvail($otherMethod->id)->assertNotFound();
        $this->setAvail(false, null, $otherMethod->id)->assertNotFound();
        $this->setAvail(false, $otherChannel->id)->assertNotFound();
        $this->setAvail(false, $this->channel->id, null, $otherToken)->assertNotFound();
        $this->listAvail(null, $otherToken)->assertNotFound();
        $this->setAvail(false, (string) Str::uuid())->assertNotFound();
        $this->assertSame($before, PaymentMethodChannelAvailability::query()->withoutGlobalScopes()->count());
        $this->assertCount(0, $this->events());
    }
}

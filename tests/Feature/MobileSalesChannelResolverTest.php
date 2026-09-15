<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Services\Commerce\MobileSalesChannelResolver;
use App\Tenancy\StorefrontContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Mobile Sales Channel Foundation
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن `SalesChannel::TYPE_MOBILE` الموجود أصلاً صار قناةً قابلة للحل
 *  بأمان عبر `MobileSalesChannelResolver`، بلا أي اعتماد على `Storefront`
 *  أو حسم المضيف أو `RequireStorefrontMutationGateway`، وبلا تغيير في سلوك
 *  الويب الحالي. لا Catalog/Cart/Checkout API هنا — القناة فقط.
 *
 *  تشغيل: php artisan test --filter=MobileSalesChannelResolverTest
 */
class MobileSalesChannelResolverTest extends TestCase
{
    use RefreshDatabase;

    private function resolver(): MobileSalesChannelResolver
    {
        return app(MobileSalesChannelResolver::class);
    }

    private function makeTenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => 'مستأجر '.$slug, 'slug' => $slug,
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
    }

    // ── 1. سلوك الويب لا يتغيّر ──────────────────────────────────────────

    /** @test */
    public function storefront_still_rejects_a_non_web_sales_channel(): void
    {
        $tenant = $this->makeTenant('web-unchanged');
        app(TenantContext::class)->set($tenant->id);

        $mobileChannel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE,
        ]);

        $this->expectException(RuntimeException::class);
        Storefront::create([
            'sales_channel_id' => $mobileChannel->id, 'slug' => 'store', 'name' => 'متجر',
        ]);
    }

    /** @test */
    public function storefront_still_accepts_a_web_sales_channel(): void
    {
        $tenant = $this->makeTenant('web-unchanged-2');
        app(TenantContext::class)->set($tenant->id);

        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'متجر الويب', 'type' => SalesChannel::TYPE_WEB,
        ]);

        $storefront = Storefront::create([
            'sales_channel_id' => $webChannel->id, 'slug' => 'store', 'name' => 'متجر',
        ]);

        $this->assertSame($webChannel->id, $storefront->sales_channel_id);
    }

    /** @test */
    public function resolving_a_mobile_channel_never_touches_storefront_context_storefront_id(): void
    {
        $tenant = $this->makeTenant('no-storefront-dep');
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE,
        ]);
        app(TenantContext::class)->forget();

        $this->resolver()->resolve($tenant->id, $channel->id);

        $this->assertSame(0, Storefront::withoutGlobalScopes()->count(), 'لا Storefront أُنشئ أو استُخدم لحل قناة الجوال.');
        $this->assertFalse(app(StorefrontContext::class)->hasStorefront());
    }

    // ── 2. قناة الجوال قابلة للوجود والحل وفق العقد المعتمد ──────────────

    /** @test */
    public function an_active_mobile_channel_for_the_trusted_tenant_resolves_successfully(): void
    {
        $tenant = $this->makeTenant('mobile-ok');
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE,
        ]);
        app(TenantContext::class)->forget();

        $resolved = $this->resolver()->resolve($tenant->id, $channel->id);

        $this->assertSame($channel->id, $resolved->id);
        $this->assertSame(SalesChannel::TYPE_MOBILE, $resolved->type);
        $this->assertSame($tenant->id, app(TenantContext::class)->id());

        $storefrontContext = app(StorefrontContext::class);
        $this->assertSame($tenant->id, $storefrontContext->tenantId());
        $this->assertSame($channel->id, $storefrontContext->salesChannelId());
        $this->assertFalse($storefrontContext->hasStorefront());
    }

    // ── 3. عزل المستأجرين ────────────────────────────────────────────────

    /** @test */
    public function a_mobile_channel_belonging_to_another_tenant_is_denied(): void
    {
        $tenantA = $this->makeTenant('cross-a');
        $tenantB = $this->makeTenant('cross-b');

        app(TenantContext::class)->set($tenantB->id);
        $channelOfB = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق ب', 'type' => SalesChannel::TYPE_MOBILE,
        ]);
        app(TenantContext::class)->forget();

        $this->expectException(NotFoundHttpException::class);
        try {
            $this->resolver()->resolve($tenantA->id, $channelOfB->id);
        } finally {
            $this->assertNull(app(TenantContext::class)->id(), 'فشل الحلّ يجب ألا يترك سياق مستأجر معلَّقاً.');
        }
    }

    // ── 4. فشلٌ مغلق للحالات غير الصالحة ────────────────────────────────

    /** @test */
    public function an_unknown_channel_id_fails_closed(): void
    {
        $tenant = $this->makeTenant('unknown-id');

        $this->expectException(NotFoundHttpException::class);
        $this->resolver()->resolve($tenant->id, (string) \Illuminate\Support\Str::uuid());
    }

    /** @test */
    public function an_inactive_mobile_channel_fails_closed(): void
    {
        $tenant = $this->makeTenant('inactive-channel');
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE,
            'is_active' => false,
        ]);
        app(TenantContext::class)->forget();

        $this->expectException(NotFoundHttpException::class);
        $this->resolver()->resolve($tenant->id, $channel->id);
    }

    /** @test */
    public function a_web_type_channel_is_rejected_by_the_mobile_resolver(): void
    {
        $tenant = $this->makeTenant('wrong-type');
        app(TenantContext::class)->set($tenant->id);
        $webChannel = SalesChannel::create([
            'slug' => 'web', 'name' => 'متجر الويب', 'type' => SalesChannel::TYPE_WEB,
        ]);
        app(TenantContext::class)->forget();

        $this->expectException(NotFoundHttpException::class);
        $this->resolver()->resolve($tenant->id, $webChannel->id);
    }

    /** @test */
    public function empty_tenant_or_channel_ids_fail_closed(): void
    {
        $tenant = $this->makeTenant('empty-ids');
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE,
        ]);
        app(TenantContext::class)->forget();

        $this->expectException(NotFoundHttpException::class);
        $this->resolver()->resolve('', $channel->id);
    }
}

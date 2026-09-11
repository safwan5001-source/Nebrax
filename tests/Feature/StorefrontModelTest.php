<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COM-7-P2A — Storefront/StorefrontDomain model invariants
 * ═══════════════════════════════════════════════════════════════
 *  اختبارات مستوى النموذج (بلا HTTP) لقواعد الملكية والتفرّد المفروضة في
 *  `Storefront::booted()`/`StorefrontDomain::booted()` — تُثبت أنها بنيوية
 *  (تُنفَّذ عبر إنشاء Eloquent مباشر كما تفعل بقية اختبارات النموذج في هذا
 *  المستودع)، لا معتمِدة على استدعاء طبقة خدمة قد تُنسى.
 *
 *  تشغيل: php artisan test --filter=StorefrontModelTest
 */
class StorefrontModelTest extends TestCase
{
    use RefreshDatabase;

    private function makeTenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
    }

    // ── Storefront ↔ SalesChannel ownership ─────────────────────────────

    /** @test */
    public function a_storefront_cannot_bind_a_sales_channel_from_another_tenant(): void
    {
        $tenantA = $this->makeTenant('a');
        $tenantB = $this->makeTenant('b');

        app(TenantContext::class)->set($tenantB->id);
        $channelB = SalesChannel::create(['slug' => 'web', 'name' => 'ويب ب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($tenantA->id);
        $this->expectException(RuntimeException::class);
        try {
            Storefront::create(['slug' => 'main', 'name' => 'الرئيسي', 'sales_channel_id' => $channelB->id]);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function a_storefront_requires_a_web_type_sales_channel(): void
    {
        $tenant = $this->makeTenant('c');

        app(TenantContext::class)->set($tenant->id);
        $posChannel = SalesChannel::create(['slug' => 'pos', 'name' => 'نقطة بيع', 'type' => SalesChannel::TYPE_POS, 'is_active' => true]);

        $this->expectException(RuntimeException::class);
        try {
            Storefront::create(['slug' => 'main', 'name' => 'الرئيسي', 'sales_channel_id' => $posChannel->id]);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function a_storefront_with_a_valid_same_tenant_web_channel_is_created_successfully(): void
    {
        $tenant = $this->makeTenant('d');

        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'الرئيسي', 'sales_channel_id' => $channel->id]);
        app(TenantContext::class)->forget();

        $this->assertSame($tenant->id, $storefront->tenant_id);
        $this->assertTrue($storefront->is_active);
        $this->assertSame('ar', $storefront->default_locale);
    }

    // ── StorefrontDomain ↔ Storefront ownership ─────────────────────────

    /** @test */
    public function a_domain_cannot_bind_a_storefront_from_another_tenant(): void
    {
        $tenantA = $this->makeTenant('e');
        $tenantB = $this->makeTenant('f');

        app(TenantContext::class)->set($tenantB->id);
        $channelB = SalesChannel::create(['slug' => 'web', 'name' => 'ويب ب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefrontB = Storefront::create(['slug' => 'main', 'name' => 'متجر ب', 'sales_channel_id' => $channelB->id]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($tenantA->id);
        $this->expectException(RuntimeException::class);
        try {
            StorefrontDomain::create([
                'storefront_id' => $storefrontB->id,
                'hostname' => 'cross-tenant.example.com',
                'type' => StorefrontDomain::TYPE_CUSTOM,
            ]);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function duplicate_hostname_is_rejected_globally_even_across_tenants(): void
    {
        $tenantA = $this->makeTenant('g');
        $tenantB = $this->makeTenant('h');

        app(TenantContext::class)->set($tenantA->id);
        $channelA = SalesChannel::create(['slug' => 'web', 'name' => 'ويب أ', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefrontA = Storefront::create(['slug' => 'main', 'name' => 'متجر أ', 'sales_channel_id' => $channelA->id]);
        StorefrontDomain::create([
            'storefront_id' => $storefrontA->id,
            'hostname' => 'shared-name.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
        ]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($tenantB->id);
        $channelB = SalesChannel::create(['slug' => 'web', 'name' => 'ويب ب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefrontB = Storefront::create(['slug' => 'main', 'name' => 'متجر ب', 'sales_channel_id' => $channelB->id]);

        $this->expectException(RuntimeException::class);
        try {
            // نفس الاسم حرفياً (بعد التطبيع) من مستأجرٍ آخر تماماً — يجب أن يُرفض
            // عالمياً، لا فقط ضمن نطاق tenantB.
            StorefrontDomain::create([
                'storefront_id' => $storefrontB->id,
                'hostname' => 'Shared-Name.example.com',
                'type' => StorefrontDomain::TYPE_CUSTOM,
            ]);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    // ── Hostname normalization on write ─────────────────────────────────

    /** @test */
    public function hostname_is_normalized_on_write(): void
    {
        $tenant = $this->makeTenant('i');

        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'الرئيسي', 'sales_channel_id' => $channel->id]);

        $domain = StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'HTTPS://Shop.Example.COM:8080/some/path?x=1',
            'type' => StorefrontDomain::TYPE_CUSTOM,
        ]);
        app(TenantContext::class)->forget();

        $this->assertSame('shop.example.com', $domain->hostname);
    }

    /** @test */
    public function a_malformed_hostname_is_rejected_at_write_time(): void
    {
        $tenant = $this->makeTenant('j');

        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'الرئيسي', 'sales_channel_id' => $channel->id]);

        $this->expectException(RuntimeException::class);
        try {
            StorefrontDomain::create([
                'storefront_id' => $storefront->id,
                'hostname' => 'not a hostname',
                'type' => StorefrontDomain::TYPE_CUSTOM,
            ]);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    // ── Primary domain invariant ─────────────────────────────────────────

    /** @test */
    public function at_most_one_active_primary_domain_exists_per_storefront(): void
    {
        $tenant = $this->makeTenant('k');

        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'الرئيسي', 'sales_channel_id' => $channel->id]);

        $first = StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'first.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM, 'is_primary' => true,
        ]);
        $second = StorefrontDomain::create([
            'storefront_id' => $storefront->id, 'hostname' => 'second.example.com',
            'type' => StorefrontDomain::TYPE_CUSTOM,
        ]);

        $second->makePrimary();

        $this->assertTrue($second->fresh()->is_primary);
        $this->assertFalse($first->fresh()->is_primary);

        // نطاقٌ غير أساسي وموثَّق ونشط يبقى صالحاً للحسم رغم عدم كونه الأساسي —
        // `is_primary` يتحكم بالرابط القانوني/الافتراضي فقط، لا بسلطة المستأجر (§5).
        $this->assertTrue($first->fresh()->is_active);

        app(TenantContext::class)->forget();
    }
}

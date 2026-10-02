<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion;
use App\Models\DeliveryPlatformVersionOverride;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\DeliveryPlatformConfigService;
use App\Support\DeliveryPlatformCatalog;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * DLV-FOUNDATION-1 — نطاق/نموذج ملف منصة التوصيل: الهوية، ارتباط SalesChannel(external)،
 * السلاج المحجوز والتصادم، العزل بالمستأجر، وثبات النسخ.
 *
 * تشغيل: php artisan test --filter=DeliveryPlatformProfileDomainTest
 */
class DeliveryPlatformProfileDomainTest extends TestCase
{
    use RefreshDatabase;

    private function tenant(string $slug): Tenant
    {
        $tenant = Tenant::create([
            'name' => 'مؤسسة '.$slug, 'slug' => $slug, 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($tenant->id);

        return $tenant;
    }

    private function service(): DeliveryPlatformConfigService
    {
        return app(DeliveryPlatformConfigService::class);
    }

    private function channel(string $slug, string $type = SalesChannel::TYPE_EXTERNAL, array $extra = []): SalesChannel
    {
        return SalesChannel::create(array_merge(['slug' => $slug, 'name' => $slug, 'type' => $type], $extra));
    }

    /** @test */
    public function create_makes_an_external_channel_with_the_delivery_slug_and_a_first_version_with_safe_defaults(): void
    {
        $this->tenant('dlv-create');

        $profile = $this->service()->create(['platform_key' => 'the_chefz']);

        $this->assertSame('the_chefz', $profile->platform_key);
        $channel = $profile->salesChannel;
        $this->assertSame(SalesChannel::TYPE_EXTERNAL, $channel->type);
        $this->assertSame('delivery-the-chefz', $channel->slug);
        $this->assertSame($channel->id, $profile->sales_channel_id);

        $version = $this->service()->latestVersion($profile);
        $this->assertSame(1, $version->version_number);
        // الافتراضيان يطابقان السلوك الحالي: لا تحصيل منصّة، ومرجع خارجي اختياري.
        $this->assertSame(DeliveryPlatformProfileVersion::COLLECTION_MERCHANT, $version->collection_mode);
        $this->assertSame(DeliveryPlatformProfileVersion::REFERENCE_OPTIONAL, $version->external_reference_policy);
        $this->assertSame('ذا شيفز', $version->display_name);
        $this->assertSame('The Chefz', $version->display_name_en);
        $this->assertTrue($version->is_active);
    }

    /** @test */
    public function every_catalog_platform_gets_a_distinct_hyphenated_slug_never_the_reserved_web(): void
    {
        $this->tenant('dlv-catalog');

        $slugs = [];
        foreach (DeliveryPlatformCatalog::keys() as $key) {
            $slugs[] = $this->service()->create(['platform_key' => $key])->salesChannel->slug;
        }

        $this->assertCount(6, array_unique($slugs));
        foreach ($slugs as $slug) {
            $this->assertStringStartsWith('delivery-', $slug);
            $this->assertNotSame('web', $slug);
        }
    }

    /** @test */
    public function an_unknown_platform_is_rejected_and_creates_nothing(): void
    {
        $this->tenant('dlv-unknown');
        $channels = SalesChannel::count();

        try {
            $this->service()->create(['platform_key' => 'not_a_platform']);
            $this->fail('expected rejection');
        } catch (RuntimeException) {
        }

        $this->assertSame($channels, SalesChannel::count());
        $this->assertSame(0, DeliveryPlatformProfile::count());
    }

    /** @test */
    public function an_existing_unlinked_external_channel_with_the_convention_slug_can_be_linked(): void
    {
        $this->tenant('dlv-link');
        $channel = $this->channel('delivery-keeta');

        $profile = $this->service()->create(['platform_key' => 'keeta', 'sales_channel_id' => $channel->id]);

        $this->assertSame($channel->id, $profile->sales_channel_id);
        $this->assertSame(1, SalesChannel::count());
    }

    /** @test */
    public function web_mobile_and_pos_channels_cannot_be_linked_even_with_the_convention_slug(): void
    {
        $this->tenant('dlv-type');

        foreach ([SalesChannel::TYPE_WEB, SalesChannel::TYPE_MOBILE, SalesChannel::TYPE_POS] as $type) {
            $channel = $this->channel('delivery-jahez', $type);
            try {
                $this->service()->create(['platform_key' => 'jahez', 'sales_channel_id' => $channel->id]);
                $this->fail("type {$type} must be rejected");
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('external', $e->getMessage());
            }
            $channel->forceDelete();
        }

        $this->assertSame(0, DeliveryPlatformProfile::count());
    }

    /** @test */
    public function a_conventional_slug_occupied_by_a_non_external_channel_is_a_collision_not_a_silent_reuse(): void
    {
        $this->tenant('dlv-collision');
        $occupant = $this->channel('delivery-mrsool', SalesChannel::TYPE_WEB);

        try {
            $this->service()->create(['platform_key' => 'mrsool']);
            $this->fail('expected collision');
        } catch (RuntimeException) {
        }

        $this->assertSame(SalesChannel::TYPE_WEB, $occupant->fresh()->type);
        $this->assertSame(1, SalesChannel::count());
        $this->assertSame(0, DeliveryPlatformProfile::count());
    }

    /** @test */
    public function a_conventional_slug_held_by_a_soft_deleted_channel_fails_closed(): void
    {
        $this->tenant('dlv-trashed');
        $this->channel('delivery-ninja')->delete();

        $this->expectException(RuntimeException::class);
        $this->service()->create(['platform_key' => 'ninja']);
    }

    /** @test */
    public function a_channel_with_a_reserved_or_non_matching_slug_cannot_be_linked(): void
    {
        $this->tenant('dlv-slug');

        // `web` محجوز، و`hungerstation` بلا بادئة، و`delivery-keeta` لمنصة أخرى.
        foreach (['web', 'hungerstation', 'delivery-keeta'] as $slug) {
            $channel = $this->channel($slug);
            $rejected = false;
            try {
                $this->service()->create(['platform_key' => 'hungerstation', 'sales_channel_id' => $channel->id]);
            } catch (RuntimeException) {
                $rejected = true;
            }
            $this->assertTrue($rejected, "slug {$slug} must be rejected");
        }

        $this->assertSame(0, DeliveryPlatformProfile::count());
    }

    /** @test */
    public function an_inactive_channel_cannot_be_linked(): void
    {
        $this->tenant('dlv-inactive');
        $channel = $this->channel('delivery-jahez', SalesChannel::TYPE_EXTERNAL, ['is_active' => false]);

        $this->expectException(RuntimeException::class);
        $this->service()->create(['platform_key' => 'jahez', 'sales_channel_id' => $channel->id]);
    }

    /** @test */
    public function a_foreign_tenant_channel_id_is_rejected_as_if_it_did_not_exist(): void
    {
        $a = $this->tenant('dlv-foreign-a');
        $foreign = $this->channel('delivery-keeta');
        $this->tenant('dlv-foreign-b');

        try {
            $this->service()->create(['platform_key' => 'keeta', 'sales_channel_id' => $foreign->id]);
            $this->fail('foreign channel must be rejected');
        } catch (RuntimeException $e) {
            // نفس رسالة المعرّف غير الموجود: لا كشف.
            $this->assertSame($this->messageFor('00000000-0000-4000-8000-000000000000'), $e->getMessage());
        }

        $this->assertSame(0, DeliveryPlatformProfile::count());
        app(TenantContext::class)->set($a->id);
        $this->assertSame(0, DeliveryPlatformProfile::count());
    }

    private function messageFor(string $id): string
    {
        try {
            $this->service()->create(['platform_key' => 'keeta', 'sales_channel_id' => $id]);
        } catch (RuntimeException $e) {
            return $e->getMessage();
        }

        return '';
    }

    /** @test */
    public function the_model_guard_rejects_a_foreign_channel_even_when_the_service_is_bypassed(): void
    {
        $this->tenant('dlv-model-a');
        $foreign = $this->channel('delivery-keeta');
        $this->tenant('dlv-model-b');

        $this->expectException(DomainException::class);
        DeliveryPlatformProfile::create(['sales_channel_id' => $foreign->id, 'platform_key' => 'keeta']);
    }

    /** @test */
    public function the_model_guard_rejects_a_non_external_channel_and_a_wrong_slug(): void
    {
        $this->tenant('dlv-model-type');
        $web = $this->channel('delivery-keeta', SalesChannel::TYPE_WEB);
        try {
            DeliveryPlatformProfile::create(['sales_channel_id' => $web->id, 'platform_key' => 'keeta']);
            $this->fail('web must be rejected');
        } catch (DomainException) {
        }

        $wrongSlug = $this->channel('some-channel');
        $this->expectException(DomainException::class);
        DeliveryPlatformProfile::create(['sales_channel_id' => $wrongSlug->id, 'platform_key' => 'keeta']);
    }

    /** @test */
    public function one_profile_per_platform_per_tenant_and_the_database_backstops_it(): void
    {
        $this->tenant('dlv-unique');
        $profile = $this->service()->create(['platform_key' => 'keeta']);

        try {
            $this->service()->create(['platform_key' => 'keeta']);
            $this->fail('duplicate platform must be rejected');
        } catch (RuntimeException) {
        }
        $this->assertSame(1, DeliveryPlatformProfile::count());

        // حتى لو تجاوز كودٌ الخدمة: القيد الفريد (tenant, channel/platform) يحمي.
        $this->expectException(\Illuminate\Database\QueryException::class);
        DeliveryPlatformProfile::create([
            'sales_channel_id' => $profile->sales_channel_id,
            'platform_key' => 'keeta',
        ]);
    }

    /** @test */
    public function the_same_platform_can_be_configured_independently_by_two_tenants(): void
    {
        $a = $this->tenant('dlv-twin-a');
        $profileA = $this->service()->create(['platform_key' => 'keeta', 'collection_mode' => 'platform_collected']);

        $b = $this->tenant('dlv-twin-b');
        $profileB = $this->service()->create(['platform_key' => 'keeta']);

        $this->assertNotSame($profileA->id, $profileB->id);
        $this->assertSame('delivery-keeta', $profileB->salesChannel->slug);

        app(TenantContext::class)->set($a->id);
        $this->assertSame(1, DeliveryPlatformProfile::count());
        $this->assertSame('platform_collected', $this->service()->latestVersion($profileA)->collection_mode);
        $this->assertNull(DeliveryPlatformProfile::query()->whereKey($profileB->id)->first());
        $this->assertSame($b->id, $profileB->tenant_id);
    }

    /** @test */
    public function profile_identity_is_immutable_and_profiles_are_never_deleted(): void
    {
        $this->tenant('dlv-identity');
        $profile = $this->service()->create(['platform_key' => 'keeta']);
        $other = $this->channel('delivery-jahez');

        try {
            $profile->sales_channel_id = $other->id;
            $profile->save();
            $this->fail('channel is immutable');
        } catch (DomainException) {
        }
        $profile->refresh();
        try {
            $profile->platform_key = 'jahez';
            $profile->save();
            $this->fail('platform is immutable');
        } catch (DomainException) {
        }

        $this->expectException(DomainException::class);
        $profile->fresh()->delete();
    }

    /** @test */
    public function versions_and_overrides_are_append_only(): void
    {
        $this->tenant('dlv-append');
        $branch = Branch::create(['name' => 'فرع', 'code' => 'B1']);
        $profile = $this->service()->create([
            'platform_key' => 'keeta',
            'branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'platform_collected']],
        ]);
        $version = $this->service()->latestVersion($profile);
        $override = DeliveryPlatformVersionOverride::query()->firstOrFail();

        foreach ([
            fn () => $version->update(['collection_mode' => 'platform_collected']),
            fn () => $version->delete(),
            fn () => $override->update(['collection_mode' => 'merchant_collected']),
            fn () => $override->delete(),
        ] as $mutation) {
            try {
                $mutation();
                $this->fail('mutation must be refused');
            } catch (LogicException) {
            }
        }

        $this->assertSame('merchant_collected', $version->fresh()->collection_mode);
        $this->assertSame('platform_collected', $override->fresh()->collection_mode);
    }

    /** @test */
    public function the_database_refuses_a_duplicate_version_number_for_the_same_profile(): void
    {
        $this->tenant('dlv-dupver');
        $profile = $this->service()->create(['platform_key' => 'keeta']);

        // سباق كاتبَين على الرقم نفسه: القيد الفريد (profile, version_number) هو الحارس الأخير.
        $this->expectException(\Illuminate\Database\QueryException::class);
        DeliveryPlatformProfileVersion::create([
            'delivery_platform_profile_id' => $profile->id,
            'version_number' => 1,
            'collection_mode' => 'merchant_collected',
            'external_reference_policy' => 'optional',
            'display_name' => 'x',
            'is_active' => true,
            'effective_from' => now(),
        ]);
    }

    /** @test */
    public function writes_without_tenant_context_or_with_a_forged_tenant_are_rejected_by_the_models(): void
    {
        $a = $this->tenant('dlv-ctx-a');
        $profile = $this->service()->create(['platform_key' => 'keeta']);
        $b = $this->tenant('dlv-ctx-b');

        try {
            DeliveryPlatformProfile::create([
                'tenant_id' => $a->id, 'sales_channel_id' => $profile->sales_channel_id, 'platform_key' => 'keeta',
            ]);
            $this->fail('forged tenant must be rejected');
        } catch (DomainException) {
        }

        app(TenantContext::class)->forget();
        $this->expectException(DomainException::class);
        DeliveryPlatformProfile::create(['sales_channel_id' => $profile->sales_channel_id, 'platform_key' => 'keeta']);
        $this->assertNotNull($b);
    }

    /** @test */
    public function a_foreign_branch_override_is_rejected_by_service_and_by_model(): void
    {
        $this->tenant('dlv-branch-a');
        $foreignBranch = Branch::create(['name' => 'فرع غريب', 'code' => 'FB']);
        $this->tenant('dlv-branch-b');
        $profile = $this->service()->create(['platform_key' => 'keeta']);

        try {
            $this->service()->update($profile, ['branch_overrides' => [
                ['branch_id' => $foreignBranch->id, 'collection_mode' => 'platform_collected'],
            ]]);
            $this->fail('foreign branch must be rejected');
        } catch (RuntimeException) {
        }

        $version = $this->service()->latestVersion($profile);
        $this->assertSame(1, $version->version_number);
        try {
            DeliveryPlatformVersionOverride::create([
                'delivery_platform_profile_version_id' => $version->id,
                'branch_id' => $foreignBranch->id,
                'collection_mode' => 'platform_collected',
            ]);
            $this->fail('model must reject a foreign branch');
        } catch (DomainException) {
        }
        $this->assertSame(0, DeliveryPlatformVersionOverride::count());
    }
}

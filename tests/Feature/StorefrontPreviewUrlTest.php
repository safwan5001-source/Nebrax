<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Services\Commerce\FlatHostBackfillService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P1 — «Open Store» (preview_url) يفضّل النطاق المسطّح الموثّق النشط على المضيف المتداخل القديم
 * (الذي لا تغطيه الشهادة)، بلا تعديل is_primary ولا أي بيانات، ولا يشير أبداً إلى نطاق/متجر غير نشط.
 *
 * تشغيل: php artisan test --filter=StorefrontPreviewUrlTest
 */
class StorefrontPreviewUrlTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = 'store.awjdev.xyz';

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => self::BASE]);
    }

    /** @return array{token: string, tenant_id: string} */
    private function owner(string $slug = 'dominah'): array
    {
        return $this->registerTenant($slug, "owner@{$slug}.test");
    }

    private function store(string $tenantId, string $slug, bool $active = true): Storefront
    {
        $channel = SalesChannel::withoutGlobalScopes()->create([
            'tenant_id' => $tenantId, 'slug' => 'c-'.$slug, 'name' => $slug, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        return Storefront::withoutGlobalScopes()->create([
            'tenant_id' => $tenantId, 'sales_channel_id' => $channel->id, 'slug' => $slug, 'name' => $slug, 'is_active' => $active,
        ]);
    }

    private function domain(Storefront $sf, string $host, array $o = []): StorefrontDomain
    {
        return StorefrontDomain::withoutGlobalScopes()->create(array_merge([
            'tenant_id' => $sf->tenant_id, 'storefront_id' => $sf->id, 'hostname' => $host,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN, 'is_primary' => false, 'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ], $o));
    }

    /** @return array<string, ?string> storefront id => preview_url */
    private function previews(string $token): array
    {
        $res = $this->withToken($token)->getJson('/api/commerce/workspace/storefronts')->assertOk();

        return collect($res->json('data.stores'))->pluck('preview_url', 'id')->all();
    }

    /** @test */
    public function a_verified_active_flat_host_wins_over_the_legacy_nested_primary_without_changing_data(): void
    {
        $a = $this->owner();
        $z = $this->store($a['tenant_id'], 'zhor-tyb');
        $legacy = $this->domain($z, 'zhor-tyb.dominah.store.awjdev.xyz', ['is_primary' => true]);
        $this->domain($z, 'dominah-zhor-tyb.store.awjdev.xyz');
        $before = DB::table('storefront_domains')->orderBy('hostname')->get()->toJson();

        $this->assertSame('https://dominah-zhor-tyb.store.awjdev.xyz/', $this->previews($a['token'])[$z->id]);

        $this->assertSame($before, DB::table('storefront_domains')->orderBy('hostname')->get()->toJson(), 'read path must not write');
        $this->assertTrue((bool) StorefrontDomain::withoutGlobalScopes()->find($legacy->id)->is_primary);
    }

    /** @test */
    public function a_legacy_nested_host_is_still_returned_when_it_is_the_only_option(): void
    {
        $a = $this->owner();
        $z = $this->store($a['tenant_id'], 'zhor-tyb');
        $this->domain($z, 'zhor-tyb.dominah.store.awjdev.xyz', ['is_primary' => true]);

        $this->assertSame('https://zhor-tyb.dominah.store.awjdev.xyz/', $this->previews($a['token'])[$z->id]);
    }

    /** @test */
    public function an_inactive_or_unverified_flat_host_never_beats_the_legacy_one(): void
    {
        $a = $this->owner();
        $z = $this->store($a['tenant_id'], 'zhor-tyb');
        $this->domain($z, 'zhor-tyb.dominah.store.awjdev.xyz', ['is_primary' => true]);
        $this->domain($z, 'dominah-zhor-tyb.store.awjdev.xyz', ['is_active' => false]);
        $this->domain($z, 'other-zhor-tyb.store.awjdev.xyz', ['verification_status' => 'pending']);

        $this->assertSame('https://zhor-tyb.dominah.store.awjdev.xyz/', $this->previews($a['token'])[$z->id]);
    }

    /** @test */
    public function the_inactive_h_store_never_gets_a_preview_even_after_its_flat_row_exists(): void
    {
        $a = $this->owner();
        $h = $this->store($a['tenant_id'], 'h', false);
        $this->domain($h, 'h.dominah.store.awjdev.xyz', ['is_primary' => true, 'is_active' => false]);
        $this->domain($h, 'dominah-h.store.awjdev.xyz', ['is_active' => false]);
        $this->assertNull($this->previews($a['token'])[$h->id]);

        // حتى لو كان صفّ النطاق نفسه نشطاً بينما المتجر معطَّل ⇒ لا معاينة
        DB::table('storefront_domains')->where('hostname', 'dominah-h.store.awjdev.xyz')->update(['is_active' => true]);
        $this->assertNull($this->previews($a['token'])[$h->id]);
    }

    /** @test */
    public function a_custom_primary_domain_keeps_its_precedence(): void
    {
        $a = $this->owner();
        $z = $this->store($a['tenant_id'], 'zhor-tyb');
        $this->domain($z, 'shop.example.com', ['type' => StorefrontDomain::TYPE_CUSTOM, 'is_primary' => true]);
        $this->domain($z, 'zhor-tyb.dominah.store.awjdev.xyz');
        $this->domain($z, 'dominah-zhor-tyb.store.awjdev.xyz');

        $this->assertSame('https://shop.example.com/', $this->previews($a['token'])[$z->id]);
    }

    /** @test */
    public function previews_never_cross_tenants(): void
    {
        $a = $this->owner('dominah');
        $b = $this->owner('other');
        $za = $this->store($a['tenant_id'], 'zhor-tyb');
        $zb = $this->store($b['tenant_id'], 'zhor-tyb');
        $this->domain($za, 'dominah-zhor-tyb.store.awjdev.xyz');
        $this->domain($zb, 'other-zhor-tyb.store.awjdev.xyz');
        // صفّ نطاق لمتجر A لكنه يحمل tenant_id الآخر (تلف بيانات) — لا يُستعمل
        $foreign = $this->domain($za, 'a-aaa-foreign.store.awjdev.xyz');
        DB::table('storefront_domains')->where('id', $foreign->id)->update(['tenant_id' => $b['tenant_id']]);

        $pa = $this->previews($a['token']);
        $this->assertSame('https://dominah-zhor-tyb.store.awjdev.xyz/', $pa[$za->id]);
        $this->assertArrayNotHasKey($zb->id, $pa);
        $this->assertSame('https://other-zhor-tyb.store.awjdev.xyz/', $this->previews($b['token'])[$zb->id]);
    }

    /** @test */
    public function end_to_end_after_backfill_open_store_points_to_the_flat_host_for_zhor_tyb_and_nothing_for_h(): void
    {
        $a = $this->owner();
        $z = $this->store($a['tenant_id'], 'zhor-tyb');
        $this->domain($z, 'zhor-tyb.dominah.store.awjdev.xyz', ['is_primary' => true]);
        $h = $this->store($a['tenant_id'], 'h', false);
        $this->domain($h, 'h.dominah.store.awjdev.xyz', ['is_primary' => true, 'is_active' => false]);
        $this->assertSame('https://zhor-tyb.dominah.store.awjdev.xyz/', $this->previews($a['token'])[$z->id]); // قبل

        app(FlatHostBackfillService::class)->run(['zhor-tyb.dominah.store.awjdev.xyz', 'h.dominah.store.awjdev.xyz'], true);

        $p = $this->previews($a['token']);
        $this->assertSame('https://dominah-zhor-tyb.store.awjdev.xyz/', $p[$z->id]);
        $this->assertNull($p[$h->id]);
        // الصفوف القديمة لم تتغير (أساسي ونشط/غير نشط كما هي)
        $this->assertTrue((bool) StorefrontDomain::withoutGlobalScopes()->where('hostname', 'zhor-tyb.dominah.store.awjdev.xyz')->value('is_primary'));
        $this->assertFalse((bool) StorefrontDomain::withoutGlobalScopes()->where('hostname', 'h.dominah.store.awjdev.xyz')->value('is_active'));
    }
}

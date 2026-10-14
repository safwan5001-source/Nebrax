<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\FlatHostBackfillException;
use App\Services\Commerce\FlatHostBackfillService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Backfill إدراجي للخيار A: dominah/zhor-tyb (نشط) و dominah/h (غير نشط).
 * تشغيل: php artisan test --filter=FlatHostBackfillTest  (يعمل على sqlite وpgsql في CI)
 */
class FlatHostBackfillTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = 'store.awjdev.xyz';
    private const Z = 'zhor-tyb.dominah.store.awjdev.xyz';
    private const H = 'h.dominah.store.awjdev.xyz';

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => self::BASE, 'storefront.gateway_secret' => 'bf-secret']);
    }

    private function tenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => $slug, 'slug' => $slug, 'currency' => 'SAR', 'is_active' => true,
            'vat_number' => '3'.str_pad((string) random_int(1, 9999999999999), 13, '0', STR_PAD_LEFT),
        ]);
    }

    /** @return array{storefront: Storefront, domain: StorefrontDomain, channel: SalesChannel} */
    private function legacy(Tenant $t, string $store, bool $active = true, bool $primary = true, ?string $host = null): array
    {
        $channel = SalesChannel::withoutGlobalScopes()->create([
            'tenant_id' => $t->id, 'slug' => 'c-'.$store, 'name' => $store, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $sf = Storefront::withoutGlobalScopes()->create([
            'tenant_id' => $t->id, 'sales_channel_id' => $channel->id, 'slug' => $store, 'name' => $store, 'is_active' => $active,
            'default_locale' => 'en',
        ]);
        $domain = StorefrontDomain::withoutGlobalScopes()->create([
            'tenant_id' => $t->id, 'storefront_id' => $sf->id, 'hostname' => $host ?? "{$store}.{$t->slug}.".self::BASE,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN, 'is_primary' => $primary, 'is_active' => $active,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        return ['storefront' => $sf, 'domain' => $domain, 'channel' => $channel];
    }

    /** @return array{0: Tenant, 1: array, 2: array} */
    private function prodShape(): array
    {
        $d = $this->tenant('dominah');
        $z = $this->legacy($d, 'zhor-tyb', true);
        $h = $this->legacy($d, 'h', false);

        return [$d, $z, $h];
    }

    private function snapshot(): string
    {
        return json_encode([
            DB::table('storefront_domains')->whereIn('hostname', [self::Z, self::H])->orderBy('hostname')->get(),
            DB::table('storefronts')->orderBy('id')->get(),
            DB::table('sales_channels')->orderBy('id')->get(),
            DB::table('tenants')->orderBy('id')->get(),
        ]);
    }

    private function backfill(bool $execute, array $hosts = [self::Z, self::H]): array
    {
        return app(FlatHostBackfillService::class)->run($hosts, $execute);
    }

    private function newRow(string $host): ?StorefrontDomain
    {
        return StorefrontDomain::withoutGlobalScopes()->where('hostname', $host)->first();
    }

    // ── الأمر: خيارات صريحة ───────────────────────────────────────────────

    /** @test */
    public function command_requires_exactly_one_of_dry_run_or_execute_and_writes_nothing(): void
    {
        $this->prodShape();
        $before = DB::table('storefront_domains')->count();

        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::Z]])->assertExitCode(2);
        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::Z], '--dry-run' => true, '--execute' => true])->assertExitCode(2);
        $this->assertSame($before, DB::table('storefront_domains')->count());
    }

    /** @test */
    public function command_dry_run_never_writes(): void
    {
        $this->prodShape();
        $snap = $this->snapshot();
        $count = DB::table('storefront_domains')->count();

        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::Z, self::H], '--dry-run' => true])->assertSuccessful();

        $this->assertSame($count, DB::table('storefront_domains')->count());
        $this->assertSame($snap, $this->snapshot());
    }

    /** @test */
    public function command_execute_inserts_and_is_idempotent(): void
    {
        $this->prodShape();

        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::Z, self::H], '--execute' => true])->assertSuccessful();
        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::Z, self::H], '--execute' => true])->assertSuccessful();

        $this->assertSame(4, DB::table('storefront_domains')->count());
    }

    /** @test */
    public function command_without_hosts_or_with_too_many_fails_closed(): void
    {
        $this->artisan('storefront:flat-host-backfill', ['--dry-run' => true])->assertFailed();
        $many = array_map(fn ($i) => "s{$i}.dominah.store.awjdev.xyz", range(1, 11));
        $this->artisan('storefront:flat-host-backfill', ['--host' => $many, '--dry-run' => true])->assertFailed();
    }

    // ── الخدمة: dry-run ───────────────────────────────────────────────────

    /** @test */
    public function dry_run_reports_would_insert_without_any_write(): void
    {
        $this->prodShape();
        $snap = $this->snapshot();
        $count = DB::table('storefront_domains')->count();

        $out = $this->backfill(false);

        $this->assertFalse($out['executed']);
        $by = collect($out['results'])->keyBy('legacy_host');
        $this->assertSame('would_insert', $by[self::Z]['status']);
        $this->assertSame('dominah-zhor-tyb.store.awjdev.xyz', $by[self::Z]['target_host']);
        $this->assertTrue($by[self::Z]['new_row_active']);
        $this->assertSame('dominah-h.store.awjdev.xyz', $by[self::H]['target_host']);
        $this->assertFalse($by[self::H]['new_row_active']);
        $this->assertSame($count, DB::table('storefront_domains')->count());
        $this->assertSame($snap, $this->snapshot());
    }

    /** @test */
    public function dry_run_issues_no_locking_selects_even_when_a_target_already_exists(): void
    {
        $this->prodShape();
        $this->backfill(true);

        DB::enableQueryLog();
        $this->backfill(false);
        $sql = collect(DB::getQueryLog())->pluck('query')->implode("\n");
        DB::disableQueryLog();

        $this->assertStringNotContainsStringIgnoringCase('for update', $sql);
        $this->assertSame(4, DB::table('storefront_domains')->count());
    }

    // ── الخدمة: التنفيذ ───────────────────────────────────────────────────

    /** @test */
    public function execute_inserts_exactly_two_rows_with_correct_bindings_and_states(): void
    {
        [$d, $z, $h] = $this->prodShape();
        $zRow = $this->newRow(self::Z);

        $out = $this->backfill(true);

        $this->assertTrue($out['executed']);
        $this->assertFalse($out['has_drift']);
        $this->assertSame(4, DB::table('storefront_domains')->count());

        $nz = $this->newRow('dominah-zhor-tyb.store.awjdev.xyz');
        $this->assertSame($d->id, $nz->tenant_id);
        $this->assertSame($z['storefront']->id, $nz->storefront_id);
        $this->assertSame($z['channel']->id, Storefront::withoutGlobalScopes()->find($nz->storefront_id)->sales_channel_id);
        $this->assertTrue((bool) $nz->is_active);
        $this->assertTrue($nz->isVerified());
        $this->assertFalse((bool) $nz->is_primary);
        $this->assertSame(StorefrontDomain::TYPE_AWJ_SUBDOMAIN, $nz->type);

        $nh = $this->newRow('dominah-h.store.awjdev.xyz');
        $this->assertSame($d->id, $nh->tenant_id);
        $this->assertSame($h['storefront']->id, $nh->storefront_id);
        $this->assertFalse((bool) $nh->is_active);          // غير نشط
        $this->assertFalse((bool) $nh->is_primary);
        $this->assertNotNull($zRow);
    }

    /** @test */
    public function legacy_rows_and_all_other_tables_are_untouched_and_h_store_stays_inactive(): void
    {
        [, , $h] = $this->prodShape();
        $this->tenant('bystander'); // مستأجر لا علاقة له
        $before = $this->snapshot();

        $this->backfill(true);

        $this->assertSame($before, $this->snapshot(), 'legacy domain rows, storefronts, channels, tenants must be byte-identical');
        $this->assertFalse((bool) Storefront::withoutGlobalScopes()->find($h['storefront']->id)->is_active);
        $this->assertFalse((bool) $this->newRow(self::H)->is_active);
    }

    /** @test */
    public function execute_is_idempotent_and_never_duplicates(): void
    {
        $this->prodShape();
        $this->backfill(true);
        $afterFirst = DB::table('storefront_domains')->orderBy('hostname')->get()->toJson();

        $second = $this->backfill(true);

        $this->assertSame(['already_present', 'already_present'], array_column($second['results'], 'status'));
        $this->assertFalse($second['has_drift']);
        $this->assertSame($afterFirst, DB::table('storefront_domains')->orderBy('hostname')->get()->toJson());
    }

    /** @test */
    public function drift_is_reported_never_corrected_or_silently_accepted(): void
    {
        $this->prodShape();
        $this->backfill(true);
        // شخص فعّل نطاق h الجديد يدوياً → drift
        DB::table('storefront_domains')->where('hostname', 'dominah-h.store.awjdev.xyz')->update(['is_active' => true]);
        $snap = DB::table('storefront_domains')->orderBy('hostname')->get()->toJson();

        $this->assertTrue($this->backfill(false)['has_drift']);   // dry-run يُبلّغ
        try {
            $this->backfill(true);                                // execute يرفض
            $this->fail('expected drift abort');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('drift', $e->reason);
        }
        $this->assertSame($snap, DB::table('storefront_domains')->orderBy('hostname')->get()->toJson(), 'no correction');
        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::H], '--execute' => true])->assertFailed();
    }

    /** @test */
    public function drift_on_a_later_host_rolls_back_inserts_for_earlier_hosts(): void
    {
        $d = $this->tenant('dominah');
        $this->legacy($d, 'aaa');                      // يُعالَج أولاً: لا هدف له بعد
        $this->legacy($d, 'zzz');
        $this->backfill(true, ['zzz.dominah.store.awjdev.xyz']);
        DB::table('storefront_domains')->where('hostname', 'dominah-zzz.store.awjdev.xyz')->update(['is_active' => false]); // drift
        $count = DB::table('storefront_domains')->count();

        try {
            $this->backfill(true, ['aaa.dominah.store.awjdev.xyz', 'zzz.dominah.store.awjdev.xyz']);
            $this->fail('expected drift abort');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('drift', $e->reason);
        }

        $this->assertSame($count, DB::table('storefront_domains')->count());
        $this->assertNull($this->newRow('dominah-aaa.store.awjdev.xyz'), 'earlier insert must be rolled back');
    }

    /** @test */
    public function an_existing_target_with_different_verification_is_drift_not_accepted_as_present(): void
    {
        $this->prodShape();
        $this->backfill(true);
        DB::table('storefront_domains')->where('hostname', 'dominah-zhor-tyb.store.awjdev.xyz')->update(['verification_status' => 'pending']);
        $snap = DB::table('storefront_domains')->orderBy('hostname')->get()->toJson();

        $out = $this->backfill(false);

        $this->assertTrue($out['has_drift']);
        $this->assertSame('drift', collect($out['results'])->firstWhere('legacy_host', self::Z)['flag']);
        $this->assertSame($snap, DB::table('storefront_domains')->orderBy('hostname')->get()->toJson(), 'no correction');
        $this->artisan('storefront:flat-host-backfill', ['--host' => [self::Z], '--execute' => true])->assertFailed();
    }

    /** @test */
    public function primary_constraint_is_respected_legacy_stays_the_only_active_primary(): void
    {
        [, $z] = $this->prodShape();

        $this->backfill(true);

        $activePrimary = StorefrontDomain::withoutGlobalScopes()
            ->where('storefront_id', $z['storefront']->id)->where('is_primary', true)->where('is_active', true)->get();
        $this->assertCount(1, $activePrimary);
        $this->assertSame(self::Z, $activePrimary->first()->hostname);
    }

    // ── التعارضات والتراجع ────────────────────────────────────────────────

    /** @test */
    public function target_taken_by_another_tenants_row_aborts_everything_and_rolls_back(): void
    {
        $this->prodShape();
        $other = $this->tenant('intruder');
        $this->legacy($other, 'x', true, true, 'dominah-h.store.awjdev.xyz'); // يحتل هدف h
        $count = DB::table('storefront_domains')->count();

        try {
            $this->backfill(true); // Z أولاً يُدرَج ثم H يتعارض ⇒ تراجع الكل
            $this->fail('expected conflict');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('target_taken', $e->reason);
        }

        $this->assertSame($count, DB::table('storefront_domains')->count());
        $this->assertNull($this->newRow('dominah-zhor-tyb.store.awjdev.xyz'), 'all-or-nothing');
    }

    /** @test */
    public function target_equal_to_any_tenant_slug_aborts(): void
    {
        $this->prodShape();
        $this->tenant('dominah-h'); // سلاج مستأجر آخر يطابق الشريحة

        try {
            $this->backfill(true);
            $this->fail('expected conflict');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('target_is_tenant_slug', $e->reason);
        }
        $this->assertNull($this->newRow('dominah-zhor-tyb.store.awjdev.xyz'));
    }

    /** @test */
    public function ambiguous_dash_concatenation_between_two_legacy_hosts_aborts(): void
    {
        $a = $this->tenant('a');
        $ab = $this->tenant('a-b');
        $this->legacy($a, 'b-c');
        $this->legacy($ab, 'c');

        try {
            $this->backfill(true, ['b-c.a.store.awjdev.xyz', 'c.a-b.store.awjdev.xyz']);
            $this->fail('expected conflict');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('duplicate_target', $e->reason);
        }
        $this->assertSame(2, DB::table('storefront_domains')->count());
    }

    /** @test */
    public function mismatched_tenant_between_domain_and_storefront_is_refused(): void
    {
        $d = $this->tenant('dominah');
        $x = $this->tenant('xeno');
        $z = $this->legacy($d, 'zhor-tyb');
        DB::table('storefront_domains')->where('id', $z['domain']->id)->update(['tenant_id' => $x->id]); // ربط فاسد

        try {
            $this->backfill(true, [self::Z]);
            $this->fail('expected refusal');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('tenant_mismatch', $e->reason);
        }
        $this->assertSame(1, DB::table('storefront_domains')->count());
    }

    /** @test */
    public function only_legacy_nested_managed_rows_are_eligible(): void
    {
        $d = $this->tenant('dominah');
        $this->legacy($d, 'zhor-tyb');
        DB::table('storefront_domains')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $d->id,
            'storefront_id' => Storefront::withoutGlobalScopes()->firstOrFail()->id,
            'hostname' => 'shop.example.com', 'type' => 'custom', 'is_primary' => false, 'is_active' => true,
            'verification_status' => 'verified', 'created_at' => now(), 'updated_at' => now(),
        ]);

        foreach (['shop.example.com' => 'not_managed', 'nobody.dominah.store.awjdev.xyz' => 'not_found'] as $host => $reason) {
            try {
                $this->backfill(true, [$host]);
                $this->fail('expected refusal');
            } catch (FlatHostBackfillException $e) {
                $this->assertSame($reason, $e->reason);
            }
        }
        try {
            $this->backfill(true, ['bad host/../x']);
            $this->fail('expected refusal');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('invalid_host', $e->reason);
        }
        $this->assertSame(2, DB::table('storefront_domains')->count());
    }

    /** @test */
    public function first_store_host_and_wrong_shape_rows_are_refused(): void
    {
        $d = $this->tenant('dominah');
        $this->legacy($d, 'main', true, true, 'dominah.store.awjdev.xyz'); // المتجر الأول

        try {
            $this->backfill(true, ['dominah.store.awjdev.xyz']);
            $this->fail('expected refusal');
        } catch (FlatHostBackfillException $e) {
            $this->assertSame('not_legacy_shape', $e->reason);
        }
    }

    // ── العزل والأثر على الحسم ────────────────────────────────────────────

    /** @test */
    public function same_store_slug_under_another_tenant_is_not_touched_or_created(): void
    {
        $this->prodShape();
        $other = $this->tenant('other');
        $this->legacy($other, 'h', true);
        $otherBefore = json_encode(DB::table('storefront_domains')->where('tenant_id', $other->id)->get());

        $this->backfill(true);

        $this->assertNull($this->newRow('other-h.store.awjdev.xyz'));
        $this->assertSame($otherBefore, json_encode(DB::table('storefront_domains')->where('tenant_id', $other->id)->get()));
        $this->assertSame(
            Tenant::where('slug', 'dominah')->value('id'),
            $this->newRow('dominah-h.store.awjdev.xyz')->tenant_id,
        );
    }

    /** @test */
    public function after_backfill_new_hosts_resolve_exactly_and_legacy_https_behaviour_is_unchanged(): void
    {
        $this->prodShape();
        $legacyZBefore = $this->getJson('http://'.self::Z.'/store/v1/storefront')->status();
        $legacyHBefore = $this->getJson('http://'.self::H.'/store/v1/storefront')->status();

        $this->backfill(true);

        // الجديد: النشط يحسم لمتجره، وغير النشط 404
        $this->getJson('http://dominah-zhor-tyb.store.awjdev.xyz/store/v1/storefront')->assertOk();
        $this->getJson('http://dominah-h.store.awjdev.xyz/store/v1/storefront')->assertNotFound();
        // القديم: سلوكه كما كان تماماً — لا redirect ولا تغيير (والـTLS خارج التطبيق: غير مُصلَح)
        $this->assertSame($legacyZBefore, $this->getJson('http://'.self::Z.'/store/v1/storefront')->status());
        $this->assertSame($legacyHBefore, $this->getJson('http://'.self::H.'/store/v1/storefront')->status());
        $this->assertNotContains($this->getJson('http://'.self::Z.'/store/v1/storefront')->status(), [301, 302, 307, 308]);
    }

    /** @test */
    public function resolution_has_no_cross_tenant_fallback_for_the_new_hosts(): void
    {
        $this->prodShape();
        $other = $this->tenant('other');
        $this->legacy($other, 'h', true);
        $this->backfill(true);

        // مضيف مشابه لكن غير مسجَّل ⇒ 404 (لا مطابقة تقريبية)
        $this->getJson('http://other-h.store.awjdev.xyz/store/v1/storefront')->assertNotFound();
        $this->getJson('http://dominah-zhor.store.awjdev.xyz/store/v1/storefront')->assertNotFound();
        // ترويسة معاد توجيهها بلا سرّ لا تنقل المستأجر
        $this->withHeaders(['X-Storefront-Forwarded-Host' => 'dominah-zhor-tyb.store.awjdev.xyz'])
            ->getJson('http://dominah-h.store.awjdev.xyz/store/v1/storefront')->assertNotFound();
    }
}

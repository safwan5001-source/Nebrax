<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\DeliveryPlatformVersionOverride;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DeliveryPlatformConfigService;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * DLV-FOUNDATION-1 — الإلحاقية والحلّ التاريخي: معرّف نسخة مسجَّل يُحلّ دوماً لنفس
 * الإعداد بعد أي تعديل لاحق على الملف أو السياسات أو تجاوزات الفروع.
 *
 * تشغيل: php artisan test --filter=DeliveryPlatformVersioningTest
 */
class DeliveryPlatformVersioningTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create([
            'name' => 'مؤسسة التوصيل', 'slug' => 'dlv-ver', 'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function svc(): DeliveryPlatformConfigService
    {
        return app(DeliveryPlatformConfigService::class);
    }

    private function branch(string $code): Branch
    {
        return Branch::create(['name' => "فرع {$code}", 'code' => $code]);
    }

    private function versionCount(DeliveryPlatformProfile $profile): int
    {
        return Version::query()->where('delivery_platform_profile_id', $profile->id)->count();
    }

    /** @test */
    public function an_edit_appends_a_new_version_and_the_recorded_version_keeps_resolving_to_the_original_settings(): void
    {
        $branch = $this->branch('B1');
        $profile = $this->svc()->create([
            'platform_key' => 'hungerstation',
            'collection_mode' => 'platform_collected',
            'external_reference_policy' => 'required',
            'display_name' => 'هنقرستيشن', 'logo_asset_key' => 'brands/hs.svg',
            'branch_overrides' => [['branch_id' => $branch->id, 'external_reference_policy' => 'none']],
        ]);
        $v1 = $this->svc()->latestVersion($profile);
        $before = $this->svc()->resolve($profile, $branch->id, $v1->id);

        // تعديل متتابع: سياسة التحصيل، سياسة المرجع، الأسماء، التفعيل، وتجاوز الفرع.
        $this->svc()->update($profile, ['collection_mode' => 'merchant_collected']);
        $this->svc()->update($profile, ['external_reference_policy' => 'optional']);
        $this->svc()->update($profile, ['display_name' => 'اسم جديد', 'display_name_en' => 'New', 'logo_asset_key' => null]);
        $this->svc()->update($profile, ['branch_overrides' => [
            ['branch_id' => $branch->id, 'collection_mode' => 'merchant_collected', 'external_reference_policy' => 'required'],
        ]]);
        $this->svc()->update($profile, ['branch_overrides' => []]);
        $this->svc()->update($profile, ['is_active' => false]);

        $this->assertSame(7, $this->versionCount($profile));
        $this->assertSame($before, $this->svc()->resolve($profile, $branch->id, $v1->id));
        $this->assertSame('platform_collected', $before['collection_mode']);
        $this->assertSame('none', $before['external_reference_policy']);
        $this->assertTrue($before['branch_override_applied']);
        $this->assertTrue($before['is_active']);

        // والنسخة الحالية تعكس كل التعديلات.
        $current = $this->svc()->resolve($profile, $branch->id);
        $this->assertSame(7, $current['version_number']);
        $this->assertSame('merchant_collected', $current['collection_mode']);
        $this->assertSame('optional', $current['external_reference_policy']);
        $this->assertFalse($current['branch_override_applied']);
        $this->assertFalse($current['is_active']);
        $this->assertNull($current['logo_asset_key']);
    }

    /** @test */
    public function every_historical_version_resolves_to_exactly_its_own_snapshot(): void
    {
        $branch = $this->branch('B2');
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $ids = [$this->svc()->latestVersion($profile)->id];

        $steps = [
            ['collection_mode' => 'platform_collected'],
            ['branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'merchant_collected']]],
            ['external_reference_policy' => 'required'],
            ['branch_overrides' => [['branch_id' => $branch->id, 'external_reference_policy' => 'none']]],
        ];
        $expected = [['merchant_collected', 'optional', false]];
        $expected[] = ['platform_collected', 'optional', false];
        $expected[] = ['merchant_collected', 'optional', true];   // override: mode
        $expected[] = ['merchant_collected', 'required', true];   // override مُنسوخ كما هو
        $expected[] = ['platform_collected', 'none', true];       // override استُبدل: سياسة المرجع فقط

        foreach ($steps as $step) {
            $this->svc()->update($profile, $step);
            $ids[] = $this->svc()->latestVersion($profile)->id;
        }

        foreach ($ids as $i => $versionId) {
            $r = $this->svc()->resolve($profile, $branch->id, $versionId);
            $this->assertSame($i + 1, $r['version_number']);
            $this->assertSame($expected[$i], [$r['collection_mode'], $r['external_reference_policy'], $r['branch_override_applied']], "version ".($i + 1));
        }
    }

    /** @test */
    public function a_no_op_update_does_not_append_a_version_and_overrides_carry_forward_unchanged(): void
    {
        $branch = $this->branch('B3');
        $profile = $this->svc()->create([
            'platform_key' => 'jahez',
            'branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'platform_collected']],
        ]);

        $this->svc()->update($profile, ['collection_mode' => 'merchant_collected', 'external_reference_policy' => 'optional']);
        $this->svc()->update($profile, ['branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'platform_collected']]]);
        $this->assertSame(1, $this->versionCount($profile));

        // تعديل حقل غير متعلق بالتجاوز يحمله كما هو إلى النسخة الجديدة.
        $this->svc()->update($profile, ['external_reference_policy' => 'required']);
        $this->assertSame(2, $this->versionCount($profile));
        $v2 = $this->svc()->latestVersion($profile);
        $this->assertSame('platform_collected', $this->svc()->resolve($profile, $branch->id, $v2->id)['collection_mode']);
        $this->assertSame(2, DeliveryPlatformVersionOverride::count()); // لقطة لكل نسخة
    }

    /** @test */
    public function a_branch_override_edit_creates_a_new_version_and_never_rewrites_the_old_override_rows(): void
    {
        $branch = $this->branch('B4');
        $profile = $this->svc()->create([
            'platform_key' => 'mrsool',
            'branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'platform_collected']],
        ]);
        $v1 = $this->svc()->latestVersion($profile);
        $row1 = DeliveryPlatformVersionOverride::query()->firstOrFail();

        $this->svc()->update($profile, ['branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'merchant_collected']]]);

        $v2 = $this->svc()->latestVersion($profile);
        $this->assertNotSame($v1->id, $v2->id);
        $this->assertSame('platform_collected', $row1->fresh()->collection_mode);
        $this->assertSame('platform_collected', $this->svc()->resolve($profile, $branch->id, $v1->id)['collection_mode']);
        $this->assertSame('merchant_collected', $this->svc()->resolve($profile, $branch->id, $v2->id)['collection_mode']);
        $this->assertSame(2, DeliveryPlatformVersionOverride::count());
    }

    /** @test */
    public function a_branch_without_an_override_inherits_the_version_and_a_null_override_field_inherits_too(): void
    {
        $withOverride = $this->branch('B5');
        $plain = $this->branch('B6');
        $profile = $this->svc()->create([
            'platform_key' => 'ninja',
            'collection_mode' => 'platform_collected',
            'external_reference_policy' => 'required',
            'branch_overrides' => [['branch_id' => $withOverride->id, 'external_reference_policy' => 'none']],
        ]);

        $a = $this->svc()->resolve($profile, $withOverride->id);
        $this->assertSame(['platform_collected', 'none', true], [$a['collection_mode'], $a['external_reference_policy'], $a['branch_override_applied']]);

        $b = $this->svc()->resolve($profile, $plain->id);
        $this->assertSame(['platform_collected', 'required', false], [$b['collection_mode'], $b['external_reference_policy'], $b['branch_override_applied']]);

        $none = $this->svc()->resolve($profile);
        $this->assertNull($none['branch_id']);
        $this->assertSame('required', $none['external_reference_policy']);
    }

    /** @test */
    public function resolution_by_timestamp_returns_the_version_effective_at_that_time(): void
    {
        Carbon::setTestNow('2026-10-01 10:00:00');
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        Carbon::setTestNow('2026-10-02 10:00:00');
        $this->svc()->update($profile, ['collection_mode' => 'platform_collected']);
        Carbon::setTestNow('2026-10-03 10:00:00');
        $this->svc()->update($profile, ['collection_mode' => 'merchant_collected']);

        $at = fn (string $when) => $this->svc()->resolve($profile, null, null, Carbon::parse($when));

        $this->assertNull($at('2026-09-30 00:00:00'));
        $this->assertSame(1, $at('2026-10-01 12:00:00')['version_number']);
        $this->assertSame('platform_collected', $at('2026-10-02 12:00:00')['collection_mode']);
        $this->assertSame(3, $at('2026-12-31 00:00:00')['version_number']);
    }

    /** @test */
    public function resolution_by_timestamp_honours_utc_offsets(): void
    {
        Carbon::setTestNow('2026-10-02 07:00:00'); // UTC (توقيت التطبيق)
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        Carbon::setTestNow('2026-10-02 12:00:00');
        $this->svc()->update($profile, ['collection_mode' => 'platform_collected']);

        // 09:59+03:00 = 06:59 UTC: قبل أي نسخة. 10:00+03:00 = 07:00 UTC: النسخة 1 لا 2.
        $this->assertNull($this->svc()->resolve($profile, null, null, Carbon::parse('2026-10-02T09:59:00+03:00')));
        $this->assertSame(1, $this->svc()->resolve($profile, null, null, Carbon::parse('2026-10-02T10:00:00+03:00'))['version_number']);
        // 14:59+03:00 = 11:59 UTC: ما زالت 1؛ 15:00+03:00 = 12:00 UTC: النسخة 2.
        $this->assertSame(1, $this->svc()->resolve($profile, null, null, Carbon::parse('2026-10-02T14:59:00+03:00'))['version_number']);
        $this->assertSame(2, $this->svc()->resolve($profile, null, null, Carbon::parse('2026-10-02T15:00:00+03:00'))['version_number']);
        // نفس اللحظة بإزاحة أخرى تعطي النتيجة نفسها.
        $this->assertSame(2, $this->svc()->resolve($profile, null, null, Carbon::parse('2026-10-02T12:00:00+00:00'))['version_number']);
        $this->assertSame(2, $this->svc()->resolve($profile, null, null, Carbon::parse('2026-10-02T05:00:00-07:00'))['version_number']);
    }

    /** @test */
    public function versions_written_within_the_same_instant_get_distinct_ordered_effective_times(): void
    {
        Carbon::setTestNow('2026-10-02 10:00:00'); // الساعة مجمَّدة: ثلاث كتابات في اللحظة نفسها
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $this->svc()->update($profile, ['collection_mode' => 'platform_collected']);
        $this->svc()->update($profile, ['collection_mode' => 'merchant_collected']);

        $times = Version::query()->where('delivery_platform_profile_id', $profile->id)
            ->orderBy('version_number')->get()->map(fn ($v) => $v->effective_from->format('Y-m-d H:i:s.u'))->all();
        $this->assertSame(['2026-10-02 10:00:00.000000', '2026-10-02 10:00:00.000001', '2026-10-02 10:00:00.000002'], $times);

        // لحظة بين الكتابتين تُحلّ إلى النسخة التي كانت فعّالة فعلاً، لا الأحدث.
        $at = fn (string $t) => $this->svc()->resolve($profile, null, null, Carbon::parse($t))['version_number'];
        $this->assertSame(1, $at('2026-10-02 10:00:00.000000'));
        $this->assertSame(2, $at('2026-10-02 10:00:00.000001'));
        $this->assertSame(3, $at('2026-10-02 10:00:00.000002'));
    }

    /** @test */
    public function version_and_timestamp_together_are_rejected(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $version = $this->svc()->latestVersion($profile);

        $this->expectException(RuntimeException::class);
        $this->svc()->resolve($profile, null, $version->id, Carbon::now());
    }

    /** @test */
    public function a_version_cannot_be_resolved_through_another_profile_even_inside_the_same_tenant(): void
    {
        $keeta = $this->svc()->create(['platform_key' => 'keeta']);
        $jahez = $this->svc()->create(['platform_key' => 'jahez']);
        $keetaVersion = $this->svc()->latestVersion($keeta);

        $this->assertNull($this->svc()->resolve($jahez, null, $keetaVersion->id));
        $this->assertSame($keetaVersion->id, $this->svc()->resolve($keeta, null, $keetaVersion->id)['version_id']);
    }

    /** @test */
    public function another_tenants_version_never_resolves_and_another_tenants_branch_is_rejected(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $version = $this->svc()->latestVersion($profile);
        $ownBranch = $this->branch('OWN');

        $other = Tenant::create(['name' => 'أخرى', 'slug' => 'dlv-ver-other', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $foreignProfile = $this->svc()->create(['platform_key' => 'keeta']);

        // نسخة مستأجر أ لا تُحلّ عبر ملف مستأجر ب.
        $this->assertNull($this->svc()->resolve($foreignProfile, null, $version->id));
        // وفرع مستأجر أ غير متاح لمستأجر ب.
        $this->expectException(RuntimeException::class);
        $this->svc()->resolve($foreignProfile, $ownBranch->id);
    }

    /** @test */
    public function version_numbers_are_sequential_and_effective_from_never_decreases(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        foreach (['platform_collected', 'merchant_collected', 'platform_collected'] as $mode) {
            $this->svc()->update($profile, ['collection_mode' => $mode]);
        }

        $versions = Version::query()->where('delivery_platform_profile_id', $profile->id)->orderBy('version_number')->get();
        $this->assertSame([1, 2, 3, 4], $versions->pluck('version_number')->all());
        $previous = null;
        foreach ($versions as $version) {
            if ($previous !== null) {
                $this->assertTrue($version->effective_from->gte($previous));
            }
            $previous = $version->effective_from;
        }
    }

    /** @test */
    public function deactivation_is_a_new_version_the_profile_mirror_follows_and_history_still_shows_active(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $v1 = $this->svc()->latestVersion($profile);

        $profile = $this->svc()->update($profile, ['is_active' => false, 'change_reason' => 'إيقاف مؤقت']);
        $this->assertFalse($profile->is_active);
        $v2 = $this->svc()->latestVersion($profile);
        $this->assertFalse($v2->is_active);
        $this->assertSame('إيقاف مؤقت', $v2->change_reason);
        $this->assertTrue($this->svc()->resolve($profile, null, $v1->id)['is_active']);

        $profile = $this->svc()->update($profile, ['is_active' => true]);
        $this->assertTrue($profile->is_active);
        $this->assertSame(3, $this->versionCount($profile));
    }

    /** @test */
    public function a_failed_update_is_atomic_no_partial_version_and_no_orphan_overrides(): void
    {
        $good = $this->branch('GOOD');
        $profile = $this->svc()->create(['platform_key' => 'keeta']);

        $other = Tenant::create(['name' => 'أخرى', 'slug' => 'dlv-atomic-other', 'vat_number' => '300000000000003', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        $foreign = $this->branch('FOREIGN');
        app(TenantContext::class)->set($this->tenant->id);

        try {
            $this->svc()->update($profile, [
                'collection_mode' => 'platform_collected',
                'branch_overrides' => [
                    ['branch_id' => $good->id, 'collection_mode' => 'platform_collected'],
                    ['branch_id' => $foreign->id, 'collection_mode' => 'platform_collected'],
                ],
            ]);
            $this->fail('foreign branch must abort the update');
        } catch (RuntimeException) {
        }

        $this->assertSame(1, $this->versionCount($profile));
        $this->assertSame(0, DeliveryPlatformVersionOverride::count());
        $this->assertSame('merchant_collected', $this->svc()->latestVersion($profile)->collection_mode);
    }

    /** @test */
    public function invalid_values_and_malformed_overrides_are_rejected(): void
    {
        $branch = $this->branch('VAL');
        $profile = $this->svc()->create(['platform_key' => 'keeta']);

        $cases = [
            ['collection_mode' => 'nonsense'],
            ['external_reference_policy' => 'maybe'],
            ['branch_overrides' => [['branch_id' => $branch->id]]],                                   // بلا حقل
            ['branch_overrides' => [['collection_mode' => 'platform_collected']]],                    // بلا فرع
            ['branch_overrides' => [
                ['branch_id' => $branch->id, 'collection_mode' => 'platform_collected'],
                ['branch_id' => $branch->id, 'collection_mode' => 'merchant_collected'],
            ]],                                                                                       // تكرار
            ['branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'bad']]],
        ];
        foreach ($cases as $i => $case) {
            $rejected = false;
            try {
                $this->svc()->update($profile, $case);
            } catch (RuntimeException) {
                $rejected = true;
            }
            $this->assertTrue($rejected, "case {$i}");
        }

        $this->assertSame(1, $this->versionCount($profile));
    }

    /** @test */
    public function branch_authorization_is_resolved_once_per_override_batch_not_per_override(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $branches = collect(range(1, 12))->map(fn ($i) => $this->branch("BATCH{$i}"));
        $actor = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مقيَّد', 'email' => 'batch@dlv.test',
            'password' => 'password123', 'role' => 'admin',
        ]);
        $actor->branches()->sync($branches->pluck('id')->all());

        $count = 0;
        \Illuminate\Support\Facades\DB::listen(function ($q) use (&$count) {
            if (str_contains($q->sql, 'branch_user') || str_contains($q->sql, 'from "branches"')) {
                $count++;
            }
        });
        $overrides = fn (int $n) => $branches->take($n)->map(fn ($b) => ['branch_id' => $b->id, 'collection_mode' => 'platform_collected'])->all();

        $count = 0;
        $this->svc()->update($profile, ['branch_overrides' => $overrides(2)], $actor);
        $small = $count;
        $count = 0;
        $this->svc()->update($profile, ['branch_overrides' => $overrides(12)], $actor);

        $this->assertSame($small, $count, 'authorization queries must not grow with the number of overrides');
        $this->assertCount(12, DeliveryPlatformVersionOverride::query()
            ->where('delivery_platform_profile_version_id', $this->svc()->latestVersion($profile)->id)->get());
    }

    /** @test */
    public function a_branch_deleted_between_validation_and_insert_is_a_business_error_not_a_database_error(): void
    {
        $branch = $this->branch('RACE');
        $profile = $this->svc()->create(['platform_key' => 'keeta']);

        // يُحاكى السباق: يُحذف الفرع بعد اجتياز التحقق وقبل إدراج التجاوز.
        $fired = false;
        \Illuminate\Support\Facades\DB::beforeExecuting(function ($query) use (&$fired, $branch) {
            if ($fired || ! str_starts_with(strtolower($query), 'insert into "delivery_platform_version_overrides"')) {
                return;
            }
            $fired = true;
            \Illuminate\Support\Facades\DB::table('branches')->where('id', $branch->id)->delete();
        });

        try {
            $this->svc()->update($profile, ['branch_overrides' => [['branch_id' => $branch->id, 'collection_mode' => 'platform_collected']]]);
            $this->fail('expected a business error');
        } catch (RuntimeException $e) {
            $this->assertNotInstanceOf(\Illuminate\Database\QueryException::class, $e);
            $this->assertStringContainsString('لم يعد متاحاً', $e->getMessage());
        }

        $this->assertTrue($fired, 'the race hook must have fired');
        $this->assertSame(1, $this->versionCount($profile), 'no partial version after the failed insert');
        $this->assertSame(0, DeliveryPlatformVersionOverride::count());
    }

    /** @test */
    public function a_non_uuid_branch_id_is_rejected_as_unavailable_without_a_database_error(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);

        $this->expectException(RuntimeException::class);
        $this->svc()->update($profile, ['branch_overrides' => [['branch_id' => 'br-1', 'collection_mode' => 'platform_collected']]]);
    }

    /** @test */
    public function a_branch_restricted_actor_cannot_set_or_erase_overrides_outside_their_branches(): void
    {
        $mine = $this->branch('MINE');
        $theirs = $this->branch('THEIRS');
        $profile = $this->svc()->create([
            'platform_key' => 'keeta',
            'branch_overrides' => [
                ['branch_id' => $mine->id, 'collection_mode' => 'platform_collected'],
                ['branch_id' => $theirs->id, 'collection_mode' => 'platform_collected'],
            ],
        ]);
        $actor = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مقيَّد', 'email' => 'restricted@dlv.test',
            'password' => 'password123', 'role' => 'admin',
        ]);
        $actor->branches()->sync([$mine->id]);

        // لا يضبط تجاوزاً لفرعٍ خارج نطاقه.
        try {
            $this->svc()->update($profile, ['branch_overrides' => [['branch_id' => $theirs->id, 'collection_mode' => 'merchant_collected']]], $actor);
            $this->fail('outside branch must be rejected');
        } catch (RuntimeException) {
        }
        $this->assertSame(1, $this->versionCount($profile));

        // ولا يمحو تجاوز فرعٍ خارج نطاقه عند "مسح" التجاوزات.
        $this->svc()->update($profile, ['branch_overrides' => []], $actor);
        $v2 = $this->svc()->latestVersion($profile);
        $this->assertFalse($this->svc()->resolve($profile, $mine->id, $v2->id)['branch_override_applied']);
        $this->assertTrue($this->svc()->resolve($profile, $theirs->id, $v2->id)['branch_override_applied']);
        $this->assertSame($actor->id, $v2->created_by);
    }

    /** @test */
    public function configuration_changes_never_touch_the_sales_channel_or_create_commercial_records(): void
    {
        $profile = $this->svc()->create(['platform_key' => 'keeta']);
        $channel = SalesChannel::query()->findOrFail($profile->sales_channel_id);
        $snapshot = $channel->only(['slug', 'name', 'type', 'is_active', 'default_price_list_id']);

        $this->svc()->update($profile, ['collection_mode' => 'platform_collected', 'is_active' => false]);

        $this->assertSame($snapshot, $channel->fresh()->only(['slug', 'name', 'type', 'is_active', 'default_price_list_id']));
    }
}

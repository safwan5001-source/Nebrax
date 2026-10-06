<?php

namespace Tests\Feature;

use App\Models\StorefrontDomain;
use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPublishedMedia;
use App\Services\Commerce\StorefrontMediaReconciler;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Mockery;
use Tests\TestCase;

/**
 * CUST-HV V2c — تسليم وسائط المُخصِّص للعموم، بوابة المرجع المنشور، بوابة النشر
 * القرائية، والمصالِح (V0 §7.8/§7.9/§7.11، AMEND-1/4/5/9/10/12/14/16/21).
 *
 * تشغيل: php artisan test --filter=StorefrontMediaDeliveryTest
 */
class StorefrontMediaDeliveryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @return array{auth:array<string,mixed>,storefront:\App\Models\Storefront,host:string} */
    private function store(string $slug, ?string $host = null): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $seed = $this->seedMediaStorefront($auth['tenant_id']);
        $host ??= "{$slug}.example.com";

        app(TenantContext::class)->set($auth['tenant_id']);
        StorefrontDomain::create([
            'storefront_id' => $seed['storefront']->id,
            'hostname' => $host,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        return ['auth' => $auth, 'storefront' => $seed['storefront'], 'host' => $host];
    }

    /** @return array<string,mixed> */
    private int $uploads = 0;

    private function uploadMedia(array $auth, int $w = 1600, int $h = 900): array
    {
        $w += $this->uploads++; // same bytes in a tenant dedupe — every call must be a distinct image
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes($w, $h))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @param array<string,mixed> $config */
    private function publish(array $store, array $config): StorefrontPresentation
    {
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        $row = StorefrontPresentation::query()->where('storefront_id', $store['storefront']->id)->first();
        if ($row === null) {
            $row = StorefrontPresentation::create([
                'storefront_id' => $store['storefront']->id,
                'schema_version' => 3,
                'draft_config' => [],
                'published_config' => $config,
                'published_revision' => 1,
            ]);
        } else {
            $row->forceFill(['published_config' => $config, 'published_revision' => ((int) $row->published_revision) + 1])->save();
        }
        app(TenantContext::class)->forget();

        return $row;
    }

    private function ref(string $mediaId, array $extra = []): array
    {
        return ['homepage' => ['sections' => [['id' => 's1', 'design' => ['background' => ['media' => ['mediaId' => $mediaId] + $extra]]]]]];
    }

    private function url(array $store, string $path): string
    {
        return "http://{$store['host']}/store/v1/media/customizer/{$path}";
    }

    // ═════════════════ مجموعة الوسائط المنشورة ═════════════════

    /** @test */
    public function the_published_media_set_follows_published_config_through_every_write_path(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-index');
        $a = $this->uploadMedia($store['auth']);
        $b = $this->uploadMedia($store['auth']);

        $row = $this->publish($store, $this->ref($a['id']));
        $this->assertSame([$a['id']], StorefrontPublishedMedia::query()->pluck('media_id')->all());

        // نشرٌ جديد يستبدل المجموعة كاملةً (لا تراكم).
        $this->publish($store, $this->ref($b['id']));
        $this->assertSame([$b['id']], StorefrontPublishedMedia::query()->pluck('media_id')->all());

        // تعديل المسودة وحدها لا يمسّ المجموعة المنشورة.
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        $row->refresh()->forceFill(['draft_config' => $this->ref($a['id'])])->save();
        app(TenantContext::class)->forget();
        $this->assertSame([$b['id']], StorefrontPublishedMedia::query()->pluck('media_id')->all());

        // وثيقةٌ منشورةٌ بلا مراجع تُفرغها؛ ومعرّفٌ عبثيٌّ غير UUID لا يدخلها.
        $this->publish($store, ['homepage' => ['sections' => [['mediaId' => 'not-a-uuid']]]]);
        $this->assertSame(0, StorefrontPublishedMedia::query()->count());
    }

    // ═════════════════ التسليم العام ═════════════════

    /** @test */
    public function a_published_base_variant_is_served_privately_with_a_content_etag_and_unpublishing_ends_it_at_once(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-base');
        $media = $this->uploadMedia($store['auth']);
        $this->publish($store, $this->ref($media['id']));

        $response = $this->get($this->url($store, "{$media['id']}/768w.webp"))->assertOk();
        $response->assertHeader('Content-Type', 'image/webp');
        $response->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));
        $this->assertStringContainsString('private', (string) $response->headers->get('Cache-Control'));
        $this->assertStringNotContainsString('public', (string) $response->headers->get('Cache-Control'), 'the origin is never shared-cacheable (AMEND-16)');
        $etag = (string) $response->headers->get('ETag');
        $this->assertNotSame('', $etag);
        $this->assertStringStartsWith('RIFF', (string) $response->streamedContent());

        // إعادة التحقق: 304 بلا قراءة R2 (البوابة تعمل أولاً).
        $gets = count(array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'get:')));
        $this->get($this->url($store, "{$media['id']}/768w.webp"), ['If-None-Match' => $etag])->assertStatus(304);
        $this->assertSame($gets, count(array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'get:'))), 'a 304 never reads storage');

        // JPEG بصيغةٍ صريحة؛ والمصغّر مسموح للأساسي.
        $this->get($this->url($store, "{$media['id']}/768w.jpg"))->assertOk()->assertHeader('Content-Type', 'image/jpeg');
        $this->get($this->url($store, "{$media['id']}/thumb-160.webp"))->assertOk();

        // إلغاء النشر: حتى إعادة التحقق بنفس ETag تُنتج 404 جديداً (AMEND-4/16).
        $this->publish($store, ['homepage' => ['sections' => []]]);
        $this->get($this->url($store, "{$media['id']}/768w.webp"), ['If-None-Match' => $etag])->assertNotFound();
        $this->get($this->url($store, "{$media['id']}/768w.webp"))->assertNotFound();
    }

    /** @test */
    public function everything_that_should_not_be_served_is_one_uniform_404(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-404');
        $other = $this->store('sfp-404-b');
        $media = $this->uploadMedia($store['auth']);
        $foreign = $this->uploadMedia($other['auth']);
        $this->publish($store, $this->ref($media['id']));
        $this->publish($other, $this->ref($foreign['id']));

        $uniform = [];
        foreach ([
            'unknown file name' => "{$media['id']}/original.jpg",
            'rung that was never generated' => "{$media['id']}/9999w.webp",
            'bad format' => "{$media['id']}/480w.png",
            'random uuid' => Str::uuid().'/480w.webp',
            'random key' => str_repeat('a', 32).'/480w.webp',
            // وسيط مستأجرٍ آخر منشورٌ هناك — لا يُخدَم على مضيفٍ لا يشير إليه.
            'foreign tenant media' => "{$foreign['id']}/480w.webp",
        ] as $label => $path) {
            $response = $this->get($this->url($store, $path))->assertNotFound();
            $body = $response->json();
            unset($body['meta']['request_id']); // the only per-request field
            $uniform[$label] = json_encode($body);
        }
        $this->assertCount(1, array_unique($uniform), 'no response distinguishes why: '.json_encode($uniform));

        // مرجعٌ في المسودة وحدها لا يكفي.
        $draftOnly = $this->uploadMedia($store['auth']);
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        StorefrontPresentation::query()->where('storefront_id', $store['storefront']->id)->first()
            ->forceFill(['draft_config' => $this->ref($draftOnly['id'])])->save();
        app(TenantContext::class)->forget();
        $this->get($this->url($store, "{$draftOnly['id']}/480w.webp"))->assertNotFound();

        // محذوفٌ أو غير جاهز، ولو كان مُشاراً إليه.
        StorefrontMedia::withoutGlobalScopes()->whereKey($media['id'])->update(['variants_state' => 'failed']);
        $this->get($this->url($store, "{$media['id']}/480w.webp"))->assertNotFound();
        StorefrontMedia::withoutGlobalScopes()->whereKey($media['id'])->update(['variants_state' => 'ready', 'state' => 'deleted']);
        $this->get($this->url($store, "{$media['id']}/480w.webp"))->assertNotFound();

        // مضيفٌ مجهول لا يحلّ متجراً أصلاً.
        $this->get("http://unknown.example.com/store/v1/media/customizer/{$media['id']}/480w.webp")->assertNotFound();
    }

    /** @test */
    public function a_transform_derivative_is_served_only_through_its_own_row_width_and_format_and_a_published_source(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-deriv');
        $media = $this->uploadMedia($store['auth']);
        $transform = ['crop' => ['x' => 0.1, 'y' => 0.1, 'w' => 0.6, 'h' => 0.6, 'aspect' => 'free-locked', 'zoom' => 1.5]];
        $this->withToken($store['auth']['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', ['transform' => $transform])
            ->assertOk()->assertJsonPath('data.state', 'ready');
        $row = StorefrontMediaDerivative::query()->where('width', 768)->where('format', 'webp')->firstOrFail();

        // غير منشور بعد: 404.
        $this->get($this->url($store, "{$row->transform_key}/768w.webp"))->assertNotFound();

        $this->publish($store, $this->ref($media['id'], ['crop' => $transform['crop']]));
        $response = $this->get($this->url($store, "{$row->transform_key}/768w.webp"))->assertOk();
        $response->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('"'.$row->transform_key.'"', $response->headers->get('ETag'), 'the content-derived key is the ETag');
        $this->get($this->url($store, "{$row->transform_key}/768w.webp"), ['If-None-Match' => '"'.$row->transform_key.'"'])->assertStatus(304);

        // الملف يجب أن يطابق صفّ المشتقّ: عرضٌ آخر/صيغةٌ أخرى/مصغّر = 404.
        $this->get($this->url($store, "{$row->transform_key}/480w.webp"))->assertNotFound();
        $this->get($this->url($store, "{$row->transform_key}/768w.jpg"))->assertNotFound();
        $this->get($this->url($store, "{$row->transform_key}/thumb-160.webp"))->assertNotFound();

        // فشل المشتقّ ⇒ 404 (لا تسليم لحالةٍ غير جاهزة).
        $row->forceFill(['state' => 'failed', 'error_code' => 'processing_failed'])->save();
        $this->get($this->url($store, "{$row->transform_key}/768w.webp"))->assertNotFound();
    }

    // ═════════════════ بوابة النشر (قراءةٌ فقط) ═════════════════

    /** @test */
    public function the_publish_gate_names_the_path_and_a_stable_code_for_every_media_problem_and_never_generates(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-gate');
        $ready = $this->uploadMedia($store['auth']);
        $unaltered = $this->uploadMedia($store['auth']);
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        StorefrontMedia::query()->whereKey($ready['id'])->update(['alt_ar' => 'صورة', 'alt_en' => 'Photo']);
        $failedBase = StorefrontMedia::query()->whereKey($unaltered['id'])->firstOrFail();
        $failedBase->forceFill(['variants_state' => 'failed'])->save();

        $validator = new StorefrontPresentationPublishValidator;
        $doc = static fn (array $refs): array => ['homepage' => ['sections' => array_map(
            static fn (array $r, int $i): array => ['id' => "s{$i}", 'media' => $r],
            $refs,
            array_keys($refs),
        )]];

        $errors = $validator->errors($doc([
            ['mediaId' => (string) Str::uuid()],                                       // 0: غير موجود
            ['mediaId' => $unaltered['id']],                                            // 1: السلّم غير جاهز
            ['mediaId' => $ready['id']],                                                // 2: سليم (alt من المكتبة)
            ['mediaId' => $ready['id'], 'alt' => ['ar' => '', 'en' => '']],             // 3: السلّم يسدّ العجز
            ['mediaId' => $ready['id'], 'crop' => ['x' => 2, 'y' => 0, 'w' => 1, 'h' => 1, 'aspect' => '1:1']], // 4: تحويل غير صالح
            ['mediaId' => $ready['id'], 'rotate' => 90],                                // 5: مشتقّ غائب
        ]));

        $codes = array_map(static fn (array $e): string => $e['code'], $errors);
        $this->assertSame([
            'homepage.sections.0.media.mediaId' => 'media_missing',
            'homepage.sections.1.media.mediaId' => 'media_not_ready',
            'homepage.sections.4.media.crop' => 'transform_invalid',
            'homepage.sections.5.media.crop' => 'derivative_not_ready',
        ], $codes);
        $this->assertSame([], array_filter($this->r2Calls, static fn (string $c): bool => str_starts_with($c, 'put:') && str_contains($c, 'derivative')), 'publishing generated nothing');
        $this->assertSame(0, StorefrontMediaDerivative::query()->count(), 'a missing derivative is rejected, never generated (AMEND-9)');
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function alt_is_resolved_per_locale_decorative_is_exempt_and_arabic_never_stands_in_for_english(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-alt');
        $media = $this->uploadMedia($store['auth']);
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        $validator = new StorefrontPresentationPublishValidator;
        $errorsFor = fn (array $ref): array => array_map(static fn (array $e): string => $e['code'], $validator->errors(['m' => $ref]));

        $this->assertSame(['m.alt.ar' => 'alt_required_ar', 'm.alt.en' => 'alt_required_en'], $errorsFor(['mediaId' => $media['id']]));
        $this->assertSame(['m.alt.en' => 'alt_required_en'], $errorsFor(['mediaId' => $media['id'], 'alt' => ['ar' => 'نص عربي']]), 'AR text does not cover EN');
        $this->assertSame([], $errorsFor(['mediaId' => $media['id'], 'alt' => ['ar' => 'ع', 'en' => 'e']]));
        $this->assertSame([], $errorsFor(['mediaId' => $media['id'], 'decorative' => true]));
        $this->assertSame(['m.alt.en' => 'alt_required_en'], $errorsFor(['mediaId' => $media['id'], 'decorative' => 'yes', 'alt' => ['ar' => 'ع']]), 'only a real boolean true is decorative');

        StorefrontMedia::query()->whereKey($media['id'])->update(['alt_en' => 'Library English']);
        $this->assertSame(['m.alt.ar' => 'alt_required_ar'], $errorsFor(['mediaId' => $media['id']]), 'the library default covers its own locale only');
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_ready_derivative_passes_and_a_failed_or_pending_one_is_refused_without_regeneration(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-gate-d');
        $media = $this->uploadMedia($store['auth']);
        $transform = ['crop' => ['x' => 0.1, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '1:1', 'zoom' => 1]];
        $this->withToken($store['auth']['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', ['transform' => $transform])->assertOk();

        app(TenantContext::class)->set($store['auth']['tenant_id']);
        StorefrontMedia::query()->whereKey($media['id'])->update(['alt_ar' => 'ع', 'alt_en' => 'e']);
        $validator = new StorefrontPresentationPublishValidator;
        $ref = ['mediaId' => $media['id'], 'crop' => $transform['crop']];

        $this->assertSame([], $validator->errors(['m' => $ref]));

        StorefrontMediaDerivative::query()->limit(1)->update(['state' => 'failed', 'error_code' => 'storage_unavailable']);
        $puts = $this->r2PutCount;
        $this->assertSame('derivative_failed', $validator->errors(['m' => $ref])['m.crop']['code']);

        StorefrontMediaDerivative::query()->update(['state' => 'pending', 'claimed_at' => now()]);
        $this->assertSame('derivative_not_ready', $validator->errors(['m' => $ref])['m.crop']['code']);

        $this->assertSame($puts, $this->r2PutCount, 'the gate never writes');
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_document_without_media_never_touches_the_media_tables(): void
    {
        $this->fakeStorefrontMediaR2();
        $queries = [];
        \Illuminate\Support\Facades\DB::listen(static function ($q) use (&$queries): void {
            $queries[] = $q->sql;
        });

        $this->assertSame([], (new StorefrontPresentationPublishValidator)->errors(['homepage' => ['sections' => [['id' => 'x']]]]));
        $this->assertSame([], array_filter($queries, static fn (string $sql): bool => str_contains($sql, 'storefront_media')));
    }

    // ═════════════════ المصالِح ═════════════════

    /** @test */
    public function the_reconciler_purges_due_deleted_assets_completely_and_leaves_everything_else(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-rec');
        $other = $this->store('sfp-rec-b');
        $due = $this->uploadMedia($store['auth']);
        $notDue = $this->uploadMedia($store['auth']);
        $live = $this->uploadMedia($store['auth']);
        $foreignDue = $this->uploadMedia($other['auth']);
        $this->withToken($store['auth']['token'])->postJson(self::BASE.'/'.$due['id'].'/derivatives', ['transform' => ['rotate' => 180]])->assertOk();

        foreach ([[$due, 5], [$notDue, -5], [$foreignDue, 5]] as [$m, $days]) {
            StorefrontMedia::withoutGlobalScopes()->whereKey($m['id'])->update(['state' => 'deleted', 'deleted_at' => now(), 'purge_after' => now()->subDays($days)]);
        }
        $beforeKeys = count($this->r2KeysFor($store['auth']['tenant_id'], $due['id']));
        $this->assertGreaterThan(10, $beforeKeys);

        $dry = app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id'], 200, true);
        $this->assertTrue($dry['dry_run']);
        $this->assertSame(1, $dry['purged_assets']);
        $this->assertCount($beforeKeys, $this->r2KeysFor($store['auth']['tenant_id'], $due['id']), 'dry-run deletes nothing');

        $stats = app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id']);

        $this->assertSame(1, $stats['purged_assets']);
        $this->assertSame([], $this->r2KeysFor($store['auth']['tenant_id'], $due['id']), 'original, ladder and derivatives are all gone');
        $this->assertSame('purged', StorefrontMedia::withoutGlobalScopes()->findOrFail($due['id'])->state);
        $this->assertSame(0, StorefrontMediaDerivative::withoutGlobalScopes()->where('media_id', $due['id'])->count());
        $this->assertSame('deleted', StorefrontMedia::withoutGlobalScopes()->findOrFail($notDue['id'])->state, 'inside its grace');
        $this->assertNotEmpty($this->r2KeysFor($store['auth']['tenant_id'], $notDue['id']));
        $this->assertSame('active', StorefrontMedia::withoutGlobalScopes()->findOrFail($live['id'])->state);
        $this->assertSame('deleted', StorefrontMedia::withoutGlobalScopes()->findOrFail($foreignDue['id'])->state, 'another tenant is never touched');
        $this->assertNotEmpty($this->r2KeysFor($other['auth']['tenant_id'], $foreignDue['id']));

        // idempotent
        $again = app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id']);
        $this->assertSame(0, $again['purged_assets']);
        $this->assertNull(app(TenantContext::class)->id(), 'the tenant context is restored');
    }

    /** @test */
    public function a_storage_failure_keeps_the_asset_deleted_for_the_next_run_instead_of_orphaning_files(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-rec-fail');
        $media = $this->uploadMedia($store['auth']);
        StorefrontMedia::withoutGlobalScopes()->whereKey($media['id'])->update(['state' => 'deleted', 'deleted_at' => now(), 'purge_after' => now()->subDay()]);

        $this->r2FailDeletes = true;

        $failed = app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id']);
        $this->assertSame(1, $failed['failed_assets']);
        $this->assertSame(0, $failed['purged_assets']);
        $this->assertSame('deleted', StorefrontMedia::withoutGlobalScopes()->findOrFail($media['id'])->state);

        $this->r2FailDeletes = false;
        $this->assertSame(1, app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id'])['purged_assets'], 'the next run finishes the job');
    }

    /** @test */
    public function orphan_derivatives_are_reaped_after_the_grace_unless_any_document_still_references_the_framing(): void
    {
        $this->fakeStorefrontMediaR2();
        $store = $this->store('sfp-orphan');
        $media = $this->uploadMedia($store['auth']);
        $framing = static fn (float $x): array => ['crop' => ['x' => $x, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '1:1', 'zoom' => 1]];
        foreach ([0.1, 0.2, 0.3, 0.4] as $x) {
            $this->withToken($store['auth']['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', ['transform' => $framing($x)])->assertOk();
        }
        $this->assertSame(32, StorefrontMediaDerivative::query()->count());
        StorefrontMediaDerivative::query()->update(['created_at' => now()->subDays(3)]);

        // 0.1 في الوثيقة المنشورة، 0.2 في نسخةٍ، 0.3 في المسودة المتوافقة؛ 0.4 يتيم.
        $this->publish($store, $this->ref($media['id'], $framing(0.1)));
        $this->seedVersionWithConfig($store['auth']['tenant_id'], $store['storefront']->id, $this->ref($media['id'], $framing(0.2)));
        app(TenantContext::class)->set($store['auth']['tenant_id']);
        StorefrontPresentation::query()->first()->forceFill(['draft_config' => $this->ref($media['id'], $framing(0.3))])->save();
        app(TenantContext::class)->forget();

        $stats = app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id']);

        $this->assertSame(1, $stats['orphan_usages']);
        $this->assertSame(24, StorefrontMediaDerivative::query()->count());
        $this->assertSame(0, StorefrontMediaDerivative::query()->where('usage_key', \App\Services\Commerce\StorefrontMediaTransform::fromInput($framing(0.4))->usageKey($media['id']))->count());

        // إطارٌ حديثٌ لم يُحفَظ بعد (ضمن فترة السماح) لا يُمسّ.
        $this->withToken($store['auth']['token'])->postJson(self::BASE.'/'.$media['id'].'/derivatives', ['transform' => $framing(0.5)])->assertOk();
        $again = app(StorefrontMediaReconciler::class)->run($store['auth']['tenant_id']);
        $this->assertSame(0, $again['orphan_usages']);
        $this->assertSame(32, StorefrontMediaDerivative::query()->count());
    }

    /** @test */
    public function the_reconcile_command_requires_one_valid_tenant_and_a_bounded_limit(): void
    {
        $this->artisan('storefront-media:reconcile')->assertExitCode(\Symfony\Component\Console\Command\Command::INVALID);
        $this->artisan('storefront-media:reconcile', ['--tenant' => 'nope'])->assertExitCode(\Symfony\Component\Console\Command\Command::INVALID);
        $this->artisan('storefront-media:reconcile', ['--tenant' => (string) Str::uuid()])->assertExitCode(\Symfony\Component\Console\Command\Command::FAILURE);

        $store = $this->store('sfp-cmd');
        $this->artisan('storefront-media:reconcile', ['--tenant' => $store['auth']['tenant_id'], '--limit' => 5000])->assertExitCode(\Symfony\Component\Console\Command\Command::INVALID);
        $this->artisan('storefront-media:reconcile', ['--tenant' => $store['auth']['tenant_id'], '--dry-run' => true])->assertExitCode(\Symfony\Component\Console\Command\Command::SUCCESS);
    }
}

<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Models\StorefrontPresentationVersion;
use App\Services\Commerce\StorefrontPresentationVersionService;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUST-H1-4 — وحدة تنفيذ النشر المجدول (`StorefrontPresentationVersionService::executeScheduledPublish()`).
 * هذه الوحدة هي ما يستدعيه `ScheduledPresentationDispatcher`/الأمر المتزامن
 * مباشرة — لا عبر HTTP. مرجعها المعماري: `docs/plans/store/
 * CUST-H1-ARCH-1-...md` §11 "Scheduled publication entry"، §15.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationScheduledPublishJobTest
 */
class StorefrontPresentationScheduledPublishJobTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function listPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions';
    }

    private function itemPath(string $id, string $versionId): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions/'.$versionId;
    }

    private function schedulePath(string $id, string $versionId): string
    {
        return $this->itemPath($id, $versionId).'/schedule';
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create([
                'slug' => 'web',
                'name' => 'ويب',
                'type' => SalesChannel::TYPE_WEB,
                'is_active' => true,
            ]);

        $storefront = Storefront::create([
            'slug' => 'main',
            'name' => 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function presentationHead(string $storefrontId): ?StorefrontPresentation
    {
        return StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $storefrontId)->first();
    }

    private function version(string $versionId): ?StorefrontPresentationVersion
    {
        return StorefrontPresentationVersion::withoutGlobalScopes()->find($versionId);
    }

    /**
     * ينشئ نسخة مسودة ويجدولها لتكون **مستحقّة الآن فعلياً** — عبر الـAPI
     * أولاً (كي يمرّ عبر نفس مسار الإنتاج الحقيقي)، ثم يزيح `scheduled_for`
     * للماضي مباشرة في القاعدة (لا مسار API يقبل وقتاً ماضياً — الاستحقاق
     * وحده ما نحتاج محاكاته هنا، لا آلية الجدولة نفسها المختبرة في ملفٍّ آخر).
     *
     * @return array{version_id: string, generation: int, storefront_id: string}
     */
    private function scheduleDueNow($token, string $storefrontId, string $name = 'رمضان'): array
    {
        $created = $token->postJson($this->listPath($storefrontId), ['name' => $name])->assertCreated();
        $versionId = $created->json('data.id');

        $scheduled = $token->putJson($this->schedulePath($storefrontId, $versionId), [
            'revision' => $created->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addMinutes(10)->toIso8601String(),
            'expected_schedule_token' => $created->json('data.schedule_token'),
        ])->assertOk();

        DB::table('storefront_presentation_versions')
            ->where('id', $versionId)
            ->update(['scheduled_for' => Carbon::now('UTC')->subMinute()]);

        return [
            'version_id' => $versionId,
            'generation' => (int) $this->version($versionId)->schedule_generation,
            'storefront_id' => $storefrontId,
        ];
    }

    // ───────────────────────── Success ─────────────────────────

    /** @test */
    public function a_due_scheduled_version_publishes_and_moves_the_active_pointer(): void
    {
        $auth = $this->registerTenant('job-due', 'owner@job-due.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($due['version_id'], $head->active_version_id);
        $this->assertNull($head->scheduled_version_id);
        $this->assertSame(1, (int) $head->published_revision);
        $this->assertNotNull($head->published_at);

        $version = $this->version($due['version_id']);
        $this->assertNull($version->scheduled_for);
        $this->assertNotNull($version->last_published_at);
        $this->assertSame($due['generation'] + 1, (int) $version->schedule_generation);
    }

    /** @test */
    public function a_due_scheduled_version_with_page_presentation_publishes_it_without_information_loss(): void
    {
        // CUST-H2-1 — the last H1 lifecycle path this slice's schema bump
        // touches: a scheduled publish executes the exact same normalize/copy
        // path as an immediate one, so `pagePresentation` must survive it too.
        $auth = $this->registerTenant('job-due-page-presentation', 'owner@job-due-page-presentation.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'رمضان'])
            ->assertCreated();
        $versionId = $created->json('data.id');

        $saved = $token->putJson($this->itemPath($seeded['storefront']->id, $versionId), [
            'config' => [
                'version' => 3,
                'pagePresentation' => [
                    'product' => ['regions' => [['key' => 'availability', 'visible' => true]]],
                ],
            ],
            'revision' => 1,
        ])->assertOk();

        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $versionId), [
            'revision' => $saved->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addMinutes(10)->toIso8601String(),
            'expected_schedule_token' => $saved->json('data.schedule_token'),
        ])->assertOk();

        DB::table('storefront_presentation_versions')
            ->where('id', $versionId)
            ->update(['scheduled_for' => Carbon::now('UTC')->subMinute()]);

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $seeded['storefront']->id,
            $versionId,
            (int) $this->version($versionId)->schedule_generation,
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame(
            ['product' => ['version' => 1, 'regions' => [['id' => 'availability', 'key' => 'availability', 'visible' => true]]]],
            $head->published_config['pagePresentation'],
        );
    }

    /** @test */
    public function schedule_epoch_advances_on_successful_scheduled_publish(): void
    {
        $auth = $this->registerTenant('job-epoch', 'owner@job-epoch.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $before = $this->presentationHead($seeded['storefront']->id);
        // لا رأس بعد (لم تُنشأ نسخة) — نُنشئ ونجدول أولاً.
        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);
        $epochAfterSchedule = (int) $this->presentationHead($seeded['storefront']->id)->schedule_epoch;

        app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );

        $epochAfterPublish = (int) $this->presentationHead($seeded['storefront']->id)->schedule_epoch;
        $this->assertSame($epochAfterSchedule + 1, $epochAfterPublish);
    }

    /** @test */
    public function the_former_published_version_is_retained_and_public_parity_holds(): void
    {
        $auth = $this->registerTenant('job-parity', 'owner@job-parity.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // A منشورة فعلاً أولاً.
        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $token->postJson($this->itemPath($seeded['storefront']->id, $a->json('data.id')).'/publish', [
            'revision' => $a->json('data.revision'),
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id, 'ب');

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );
        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $outcome);

        $this->assertDatabaseHas('storefront_presentation_versions', ['id' => $a->json('data.id')]);

        $head = $this->presentationHead($seeded['storefront']->id);
        $version = $this->version($due['version_id']);
        $this->assertSame(
            json_encode($version->config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode($head->published_config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );
    }

    // ───────────────────────── Safe no-ops ─────────────────────────

    /** @test */
    public function a_stale_generation_job_is_a_safe_no_op(): void
    {
        $auth = $this->registerTenant('job-stale-gen', 'owner@job-stale-gen.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'] + 99, // جيلٌ لم يصدر بعد — محاكاة مهمّة متأخرة بجيلٍ قديم فعلياً بالمقارنة العكسية كافية لإثبات المطابقة الصارمة
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_STALE_GENERATION, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id);
        $this->assertSame($due['version_id'], $head->scheduled_version_id);
    }

    /** @test */
    public function replacing_scheduled_version_a_with_b_makes_a_stale_job_for_a_a_safe_no_op_that_never_overwrites_b(): void
    {
        $auth = $this->registerTenant('job-replace-ab', 'owner@job-replace-ab.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $dueA = $this->scheduleDueNow($token, $seeded['storefront']->id, 'أ');

        // B يستبدل A كمجدول (يُبطل جيل A تلقائياً).
        $bCreated = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();
        $currentToken = $this->version($dueA['version_id'])->schedule_generation; // غير مستخدم مباشرة؛ التوكن يأتي من رأس القائمة
        $headBeforeB = $this->presentationHead($seeded['storefront']->id);
        $listRes = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $bRow = collect($listRes->json('data'))->firstWhere('id', $bCreated->json('data.id'));

        $token->putJson($this->schedulePath($seeded['storefront']->id, $bCreated->json('data.id')), [
            'revision' => $bCreated->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addMinutes(10)->toIso8601String(),
            'expected_schedule_token' => $bRow['schedule_token'],
        ])->assertOk();

        // مهمّة A المتأخرة (بجيلها الأصلي وقت الجدولة) تصل بعد الاستبدال.
        $outcomeA = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $dueA['storefront_id'],
            $dueA['version_id'],
            $dueA['generation'],
        );
        $this->assertContains($outcomeA, [
            StorefrontPresentationVersionService::OUTCOME_NOT_SCHEDULED,
            StorefrontPresentationVersionService::OUTCOME_STALE_GENERATION,
        ]);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id, 'مهمّة A الفاسدة لم تنشر شيئاً.');
        $this->assertSame($bCreated->json('data.id'), $head->scheduled_version_id, 'B لا تزال المجدولة — لم تُمسّ.');
    }

    /** @test */
    public function a_canceled_schedule_old_job_is_a_safe_no_op(): void
    {
        $auth = $this->registerTenant('job-canceled', 'owner@job-canceled.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);

        $listRes = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $row = collect($listRes->json('data'))->firstWhere('id', $due['version_id']);

        $token->deleteJson($this->schedulePath($seeded['storefront']->id, $due['version_id']), [
            'expected_schedule_token' => $row['schedule_token'],
        ])->assertOk();

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_NOT_SCHEDULED, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id);
    }

    /** @test */
    public function a_rescheduled_old_generation_job_is_a_safe_no_op(): void
    {
        $auth = $this->registerTenant('job-resched', 'owner@job-resched.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);

        $listRes = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $row = collect($listRes->json('data'))->firstWhere('id', $due['version_id']);

        // إعادة جدولة لوقتٍ مستقبلي بعيد — الجيل يتقدّم، فتصبح مهمّة الجيل
        // الأصلي (التي كانت مستحقّة) قديمة الآن رغم أنها كانت "ستُنفَّذ" لولا
        // إعادة الجدولة.
        $token->putJson($this->schedulePath($seeded['storefront']->id, $due['version_id']), [
            'revision' => $row['revision'],
            'scheduled_for' => Carbon::now('UTC')->addDays(3)->toIso8601String(),
            'expected_schedule_token' => $row['schedule_token'],
        ])->assertOk();

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'], // الجيل القديم قبل إعادة الجدولة
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_STALE_GENERATION, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id);
        $this->assertSame($due['version_id'], $head->scheduled_version_id);
    }

    /** @test */
    public function a_duplicate_retry_after_a_successful_execution_is_idempotent(): void
    {
        $auth = $this->registerTenant('job-dup-retry', 'owner@job-dup-retry.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);
        $service = app(StorefrontPresentationVersionService::class);

        $first = $service->executeScheduledPublish($due['storefront_id'], $due['version_id'], $due['generation']);
        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $first);

        $headAfterFirst = $this->presentationHead($seeded['storefront']->id);

        // إعادة تسليم بنفس الهويّة الثلاثية تماماً — لا تعيد النشر ولا تغيّر شيئاً.
        $second = $service->executeScheduledPublish($due['storefront_id'], $due['version_id'], $due['generation']);
        $this->assertContains($second, [
            StorefrontPresentationVersionService::OUTCOME_NOT_SCHEDULED,
            StorefrontPresentationVersionService::OUTCOME_STALE_GENERATION,
        ]);

        $headAfterSecond = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame((int) $headAfterFirst->published_revision, (int) $headAfterSecond->published_revision);
        $this->assertSame($headAfterFirst->published_at->toJSON(), $headAfterSecond->published_at->toJSON());
    }

    /** @test */
    public function an_early_execution_attempt_before_the_due_time_is_a_safe_no_op(): void
    {
        $auth = $this->registerTenant('job-early', 'owner@job-early.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $created = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'مبكرة'])->assertCreated();
        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $created->json('data.id')), [
            'revision' => $created->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addHours(3)->toIso8601String(),
            'expected_schedule_token' => $created->json('data.schedule_token'),
        ])->assertOk();

        $version = $this->version($created->json('data.id'));

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $seeded['storefront']->id,
            $created->json('data.id'),
            (int) $version->schedule_generation,
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_NOT_DUE, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id);
        $this->assertSame($created->json('data.id'), $head->scheduled_version_id);
    }

    // ───────────────────────── Forward schema / failure safety ─────────────────────────

    /** @test */
    public function a_forward_schema_version_fails_closed_without_touching_live_state(): void
    {
        $auth = $this->registerTenant('job-forward', 'owner@job-forward.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);

        DB::table('storefront_presentation_versions')
            ->where('id', $due['version_id'])
            ->update(['schema_version' => StorefrontPresentationNormalizer::VERSION + 1]);

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_FORWARD_SCHEMA_REJECTED, $outcome);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id);
        $this->assertNull($head->published_config);
        // الجدولة تبقى قائمة/قابلة للتشخيص — لم تُمسَح كأنها نجحت.
        $this->assertSame($due['version_id'], $head->scheduled_version_id);

        $version = $this->version($due['version_id']);
        $this->assertNotNull($version->scheduled_for);
        $this->assertSame($due['generation'], (int) $version->schedule_generation);
    }

    /**
     * لا مسار واقعي يُتيح تجاوز `MAX_DOCUMENT_BYTES` بعد التطبيع — كل حقل
     * نصّي/مصفوفة في `StorefrontPresentationNormalizer` محدودٌ صراحةً
     * (`mb_substr`/`MAX_HOME_SECTIONS`/`MAX_CUSTOM_BLOCKS`/...)، فتفجير حجمٍ
     * زائف يتطلّب محاكاة استثناء لا فشلاً حقيقياً — CUST-H1-3 نفسها اختبرت
     * "فشل النشر" بنفس الروح: حالة تعارضٍ حقيقية (409) لا استثناءً مصطنعاً.
     * هذا الاختبار يثبت نفس ضمان "لا مساس بالحالة الحيّة عند الفشل" بمحفّزٍ
     * واقعي فعلاً — مخطّطٌ أمامي (نفس اختبار forward_schema أعلاه من زاوية
     * مختلفة): النسخة B مجدولة، لكن قبل استحقاقها يُرفع مخطّطها المخزَّن
     * فوق ما يدعمه الخادم (سيناريو تراجع/rollback حقيقي، لا مصطنع) — فتفشل
     * محاولة تنفيذها بأمان ودون أن تمسّ A المنشورة أصلاً.
     *
     * @test
     */
    public function publication_failure_preserves_the_current_live_design(): void
    {
        $auth = $this->registerTenant('job-fail-safe', 'owner@job-fail-safe.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // A منشورة فعلاً — هذا ما يجب أن يبقى دون مساس عند فشل تنفيذ ب.
        $a = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'أ'])->assertCreated();
        $token->postJson($this->itemPath($seeded['storefront']->id, $a->json('data.id')).'/publish', [
            'revision' => $a->json('data.revision'),
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();
        $headBefore = $this->presentationHead($seeded['storefront']->id);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id, 'ب');

        DB::table('storefront_presentation_versions')
            ->where('id', $due['version_id'])
            ->update(['schema_version' => StorefrontPresentationNormalizer::VERSION + 1]);

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_FORWARD_SCHEMA_REJECTED, $outcome);

        $headAfter = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($headBefore->active_version_id, $headAfter->active_version_id);
        $this->assertSame(
            json_encode($headBefore->published_config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode($headAfter->published_config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        );
        $this->assertSame((int) $headBefore->published_revision, (int) $headAfter->published_revision);
    }

    // ───────────────────────── Tenant safety ─────────────────────────

    /** @test */
    public function the_job_establishes_tenant_context_from_the_persisted_relationship_not_ambient_state(): void
    {
        $ownerAuth = $this->registerTenant('job-tenant-owner', 'owner@job-tenant-owner.test');
        $seeded = $this->seedWebStorefront($ownerAuth['tenant_id']);
        $token = $this->withToken($ownerAuth['token']);

        $due = $this->scheduleDueNow($token, $seeded['storefront']->id);

        // نضبط سياق مستأجرٍ مختلف تماماً عمداً قبل التنفيذ — الوحدة يجب أن
        // تتجاهله وتحلّ المستأجر الصحيح من علاقة Storefront المخزَّنة فقط.
        $otherAuth = $this->registerTenant('job-tenant-other', 'owner@job-tenant-other.test');
        app(TenantContext::class)->set($otherAuth['tenant_id']);

        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            $due['storefront_id'],
            $due['version_id'],
            $due['generation'],
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_PUBLISHED, $outcome);

        // بعد التنفيذ، السياق يعود لما كان عليه قبل الاستدعاء (لا تسريب).
        $this->assertSame($otherAuth['tenant_id'], app(TenantContext::class)->id());

        app(TenantContext::class)->set($ownerAuth['tenant_id']);
        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($due['version_id'], $head->active_version_id);
        app(TenantContext::class)->forget();
    }

    /** @test */
    public function a_missing_storefront_is_a_safe_no_op(): void
    {
        $outcome = app(StorefrontPresentationVersionService::class)->executeScheduledPublish(
            (string) \Illuminate\Support\Str::uuid(),
            (string) \Illuminate\Support\Str::uuid(),
            0,
        );

        $this->assertSame(StorefrontPresentationVersionService::OUTCOME_MISSING, $outcome);
    }
}

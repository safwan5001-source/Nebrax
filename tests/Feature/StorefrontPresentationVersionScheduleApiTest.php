<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * CUST-H1-4 — جدولة/استبدال/إعادة جدولة/إلغاء نشرٍ مستقبلي لنسخة عرض
 * محدَّدة. مرجعها المعماري: `docs/plans/store/CUST-H1-ARCH-1-...md` §10
 * "Schedule"، §17 "Reschedule"/"Cancel"، §34.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationVersionScheduleApiTest
 */
class StorefrontPresentationVersionScheduleApiTest extends TestCase
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

    private function publishPath(string $id, string $versionId): string
    {
        return $this->itemPath($id, $versionId).'/publish';
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, array $overrides = []): array
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
            'slug' => $overrides['slug'] ?? 'main',
            'name' => $overrides['name'] ?? 'المتجر الرئيسي',
            'sales_channel_id' => $channel->id,
            'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function presentationHead(string $storefrontId): ?StorefrontPresentation
    {
        return StorefrontPresentation::withoutGlobalScopes()
            ->where('storefront_id', $storefrontId)
            ->first();
    }

    private function futureIso(int $minutes = 60): string
    {
        return Carbon::now('UTC')->addMinutes($minutes)->toIso8601String();
    }

    /** ينشئ نسخة مسودة ويعيد هويّتها + الرمز/المراجعة الحاليين من نفس الاستجابة. */
    private function createDraft($token, string $storefrontId, string $name = 'رمضان'): array
    {
        $res = $token->postJson($this->listPath($storefrontId), ['name' => $name])->assertCreated();

        return [
            'id' => $res->json('data.id'),
            'revision' => $res->json('data.revision'),
            'schedule_token' => $res->json('data.schedule_token'),
        ];
    }

    // ───────────────────────── Schedule: success ─────────────────────────

    /** @test */
    public function initial_schedule_succeeds_and_stores_canonical_utc(): void
    {
        $auth = $this->registerTenant('sched-ok', 'owner@sched-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $scheduledFor = Carbon::now('Asia/Riyadh')->addHours(2)->toIso8601String();

        $res = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $scheduledFor,
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $this->assertSame('scheduled', $res->json('data.state'));
        $this->assertNotNull($res->json('data.scheduled_for'));

        // كانوني بالتخزين: UTC صريح (`Z`) بصرف النظر عن إزاحة الإدخال.
        $this->assertStringEndsWith('Z', $res->json('data.scheduled_for'));
        $this->assertSame(
            Carbon::parse($scheduledFor)->utc()->toIso8601String(),
            Carbon::parse($res->json('data.scheduled_for'))->utc()->toIso8601String(),
        );

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($draft['id'], $head->scheduled_version_id);
        $this->assertSame(1, (int) $head->schedule_epoch);
    }

    /** @test */
    public function returned_token_changes_on_every_successful_schedule_mutation(): void
    {
        $auth = $this->registerTenant('sched-token-change', 'owner@sched-token-change.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $r1 = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(60),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $this->assertNotSame($draft['schedule_token'], $r1->json('data.schedule_token'));

        // إعادة الجدولة على نفس النسخة تُغيّر الرمز مجدداً.
        $r2 = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(120),
            'expected_schedule_token' => $r1->json('data.schedule_token'),
        ])->assertOk();

        $this->assertNotSame($r1->json('data.schedule_token'), $r2->json('data.schedule_token'));
    }

    /** @test */
    public function scheduling_the_active_published_version_is_rejected(): void
    {
        $auth = $this->registerTenant('sched-active', 'owner@sched-active.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $published = $token->postJson($this->publishPath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertOk();

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $published->json('data.revision'),
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $published->json('data.schedule_token'),
        ])->assertStatus(409);
    }

    /** @test */
    public function a_stale_target_revision_returns_409_without_scheduling(): void
    {
        $auth = $this->registerTenant('sched-stale-rev', 'owner@sched-stale-rev.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'] + 5,
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->scheduled_version_id);
        $this->assertSame(0, (int) $head->schedule_epoch);
    }

    /** @test */
    public function a_stale_schedule_token_on_initial_scheduling_returns_409(): void
    {
        $auth = $this->registerTenant('sched-stale-tok', 'owner@sched-stale-tok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => 'clearly-not-a-real-token',
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->scheduled_version_id);
    }

    /** @test */
    public function a_stale_schedule_token_after_an_aba_schedule_cancel_cycle_returns_409(): void
    {
        $auth = $this->registerTenant('sched-aba', 'owner@sched-aba.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);
        $staleToken = $draft['schedule_token'];

        // جلسة أخرى: تجدول ثم تُلغي — العدّاد تقدّم مرتين والرمز الأصلي لم يعد صالحاً.
        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $staleToken,
        ])->assertOk();

        $token->deleteJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'expected_schedule_token' => $scheduled->json('data.schedule_token'),
        ])->assertOk();

        // طلبٌ متأخر بالرمز الأصلي القديم (قبل الجدولة/الإلغاء كليهما) يُرفض،
        // رغم أن حالة "لا جدولة قائمة" ظاهرياً تشابه حالة البداية.
        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $staleToken,
        ])->assertStatus(409);
    }

    // ───────────────────────── Replace ─────────────────────────

    /** @test */
    public function replacing_a_scheduled_version_invalidates_the_prior_one_and_clears_its_scheduled_for(): void
    {
        $auth = $this->registerTenant('sched-replace', 'owner@sched-replace.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $this->createDraft($token, $seeded['storefront']->id, 'أ');
        $b = $this->createDraft($token, $seeded['storefront']->id, 'ب');

        $scheduledA = $token->putJson($this->schedulePath($seeded['storefront']->id, $a['id']), [
            'revision' => $a['revision'],
            'scheduled_for' => $this->futureIso(60),
            'expected_schedule_token' => $a['schedule_token'],
        ])->assertOk();

        $scheduledB = $token->putJson($this->schedulePath($seeded['storefront']->id, $b['id']), [
            'revision' => $b['revision'],
            'scheduled_for' => $this->futureIso(120),
            'expected_schedule_token' => $scheduledA->json('data.schedule_token'),
        ])->assertOk();

        $this->assertSame('scheduled', $scheduledB->json('data.state'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($b['id'], $head->scheduled_version_id);
        $this->assertSame(2, (int) $head->schedule_epoch);

        $listRes = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $rows = collect($listRes->json('data'))->keyBy('id');
        $this->assertSame('draft', $rows[$a['id']]['state']);
        $this->assertNull($rows[$a['id']]['scheduled_for']);
        $this->assertSame('scheduled', $rows[$b['id']]['state']);
    }

    /** @test */
    public function a_stale_schedule_token_on_a_different_target_replacement_returns_409_and_does_not_touch_the_current_schedule(): void
    {
        $auth = $this->registerTenant('sched-replace-stale', 'owner@sched-replace-stale.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $this->createDraft($token, $seeded['storefront']->id, 'أ');
        $b = $this->createDraft($token, $seeded['storefront']->id, 'ب');

        $token->putJson($this->schedulePath($seeded['storefront']->id, $a['id']), [
            'revision' => $a['revision'],
            'scheduled_for' => $this->futureIso(60),
            'expected_schedule_token' => $a['schedule_token'],
        ])->assertOk();

        // رمز B (قبل جدولة A) صار قديماً الآن — استبدال A بـB به يُرفض.
        $token->putJson($this->schedulePath($seeded['storefront']->id, $b['id']), [
            'revision' => $b['revision'],
            'scheduled_for' => $this->futureIso(120),
            'expected_schedule_token' => $b['schedule_token'],
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($a['id'], $head->scheduled_version_id);
    }

    // ───────────────────────── Reschedule (same target) ─────────────────────────

    /** @test */
    public function rescheduling_the_same_scheduled_version_succeeds(): void
    {
        $auth = $this->registerTenant('resched-ok', 'owner@resched-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(60),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $newTime = $this->futureIso(180);
        $res = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $scheduled->json('data.revision'),
            'scheduled_for' => $newTime,
            'expected_schedule_token' => $scheduled->json('data.schedule_token'),
        ])->assertOk();

        $this->assertSame('scheduled', $res->json('data.state'));
        $this->assertSame(
            Carbon::parse($newTime)->utc()->toIso8601String(),
            Carbon::parse($res->json('data.scheduled_for'))->utc()->toIso8601String(),
        );

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($draft['id'], $head->scheduled_version_id);
        $this->assertSame(2, (int) $head->schedule_epoch);
    }

    /** @test */
    public function a_stale_reschedule_fails_and_does_not_overwrite_a_newer_reschedule(): void
    {
        $auth = $this->registerTenant('resched-stale', 'owner@resched-stale.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(60),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $winnerTime = $this->futureIso(90);
        $winner = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $scheduled->json('data.revision'),
            'scheduled_for' => $winnerTime,
            'expected_schedule_token' => $scheduled->json('data.schedule_token'),
        ])->assertOk();

        // طلبٌ متأخر يحمل الرمز الأول (قبل reschedule الفائز) — يُرفض ولا يطيح بالفائز.
        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $scheduled->json('data.revision'),
            'scheduled_for' => $this->futureIso(9999),
            'expected_schedule_token' => $scheduled->json('data.schedule_token'),
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $version = \App\Models\StorefrontPresentationVersion::withoutGlobalScopes()->find($draft['id']);
        $this->assertSame(
            Carbon::parse($winnerTime)->utc()->toIso8601String(),
            $version->scheduled_for->utc()->toIso8601String(),
        );
        $this->assertSame($draft['id'], $head->scheduled_version_id);
    }

    // ───────────────────────── Cancel ─────────────────────────

    /** @test */
    public function cancel_succeeds_and_clears_schedule_state(): void
    {
        $auth = $this->registerTenant('cancel-ok', 'owner@cancel-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $res = $token->deleteJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'expected_schedule_token' => $scheduled->json('data.schedule_token'),
        ])->assertOk();

        $this->assertSame('draft', $res->json('data.state'));
        $this->assertNull($res->json('data.scheduled_for'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->scheduled_version_id);
        $this->assertSame(2, (int) $head->schedule_epoch);
    }

    /** @test */
    public function a_stale_cancel_token_fails(): void
    {
        $auth = $this->registerTenant('cancel-stale', 'owner@cancel-stale.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $token->deleteJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'expected_schedule_token' => $draft['schedule_token'], // قديم — سبق استهلاكه بالجدولة
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($draft['id'], $head->scheduled_version_id);
    }

    /** @test */
    public function cancel_for_a_superseded_version_cannot_clear_a_newer_scheduled_version(): void
    {
        $auth = $this->registerTenant('cancel-ab', 'owner@cancel-ab.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $this->createDraft($token, $seeded['storefront']->id, 'أ');
        $b = $this->createDraft($token, $seeded['storefront']->id, 'ب');

        $scheduledA = $token->putJson($this->schedulePath($seeded['storefront']->id, $a['id']), [
            'revision' => $a['revision'],
            'scheduled_for' => $this->futureIso(60),
            'expected_schedule_token' => $a['schedule_token'],
        ])->assertOk();

        // B يستبدل A كمجدول.
        $token->putJson($this->schedulePath($seeded['storefront']->id, $b['id']), [
            'revision' => $b['revision'],
            'scheduled_for' => $this->futureIso(120),
            'expected_schedule_token' => $scheduledA->json('data.schedule_token'),
        ])->assertOk();

        // محاولة إلغاء جدولة A (لم تعد مجدولة أصلاً) — لا يُلغي جدولة B مطلقاً.
        $token->deleteJson($this->schedulePath($seeded['storefront']->id, $a['id']), [
            'expected_schedule_token' => $scheduledA->json('data.schedule_token'),
        ])->assertStatus(409);

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($b['id'], $head->scheduled_version_id);
    }

    // ───────────────────────── Cross-cutting lifecycle ─────────────────────────

    /** @test */
    public function deleting_a_scheduled_version_is_rejected_until_canceled(): void
    {
        $auth = $this->registerTenant('sched-delete', 'owner@sched-delete.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $token->deleteJson($this->itemPath($seeded['storefront']->id, $draft['id']))->assertStatus(409);
    }

    /** @test */
    public function publish_now_on_a_scheduled_version_remains_rejected(): void
    {
        $auth = $this->registerTenant('sched-publish-now', 'owner@sched-publish-now.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $token->postJson($this->publishPath($seeded['storefront']->id, $draft['id']), [
            'revision' => $scheduled->json('data.revision'),
            'expected_published_revision' => null,
            'expected_active_version_id' => null,
        ])->assertStatus(409);
    }

    /** @test */
    public function duplicating_a_scheduled_version_produces_a_draft_with_no_schedule(): void
    {
        $auth = $this->registerTenant('sched-dup', 'owner@sched-dup.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $dup = $token->postJson($this->listPath($seeded['storefront']->id), [
            'name' => 'نسخة عن المجدولة',
            'source_version_id' => $draft['id'],
        ])->assertCreated();

        $this->assertSame('draft', $dup->json('data.state'));
        $this->assertNull($dup->json('data.scheduled_for'));
    }

    /** @test */
    public function renaming_a_scheduled_version_is_allowed_and_does_not_affect_the_schedule(): void
    {
        $auth = $this->registerTenant('sched-rename', 'owner@sched-rename.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $scheduled = $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $renamed = $token->patchJson($this->itemPath($seeded['storefront']->id, $draft['id']), [
            'name' => 'اسمٌ جديد',
            'revision' => $scheduled->json('data.revision'),
        ])->assertOk();

        $this->assertSame('scheduled', $renamed->json('data.state'));
        $this->assertNotNull($renamed->json('data.scheduled_for'));

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame($draft['id'], $head->scheduled_version_id);
    }

    // ───────────────────────── Validation ─────────────────────────

    /** @test */
    public function a_past_scheduled_for_is_rejected_with_422(): void
    {
        $auth = $this->registerTenant('sched-past', 'owner@sched-past.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => Carbon::now('UTC')->subHour()->toIso8601String(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_scheduled_for_without_an_explicit_offset_is_rejected_with_422(): void
    {
        $auth = $this->registerTenant('sched-no-offset', 'owner@sched-no-offset.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => '2026-10-01T21:00:00', // بلا إزاحة صريحة
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertStatus(422);
    }

    /** @test */
    public function unknown_schedule_envelope_keys_are_rejected(): void
    {
        $auth = $this->registerTenant('sched-unknown-keys', 'owner@sched-unknown-keys.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $draft = $this->createDraft($token, $seeded['storefront']->id);

        $token->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
            'tenant_id' => 'attempted-authority-injection',
        ])->assertStatus(422);
    }

    // ───────────────────────── Tenant isolation ─────────────────────────

    /** @test */
    public function scheduling_a_foreign_storefront_is_a_safe_404(): void
    {
        $ownerAuth = $this->registerTenant('sched-iso-owner', 'owner@sched-iso-owner.test');
        $seeded = $this->seedWebStorefront($ownerAuth['tenant_id']);
        $ownerToken = $this->withToken($ownerAuth['token']);
        $draft = $this->createDraft($ownerToken, $seeded['storefront']->id);

        $attackerAuth = $this->registerTenant('sched-iso-attacker', 'owner@sched-iso-attacker.test');
        $attackerToken = $this->withToken($attackerAuth['token']);

        $attackerToken->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertStatus(404);
    }

    /** @test */
    public function scheduling_a_foreign_version_under_an_owned_storefront_url_is_a_safe_404(): void
    {
        $ownerAuth = $this->registerTenant('sched-iso-version-owner', 'owner@sched-iso-version-owner.test');
        $ownerSeeded = $this->seedWebStorefront($ownerAuth['tenant_id']);
        $ownerToken = $this->withToken($ownerAuth['token']);

        $attackerAuth = $this->registerTenant('sched-iso-version-attacker', 'owner@sched-iso-version-attacker.test');
        $attackerSeeded = $this->seedWebStorefront($attackerAuth['tenant_id']);
        $attackerToken = $this->withToken($attackerAuth['token']);
        $foreignVersion = $this->createDraft($attackerToken, $attackerSeeded['storefront']->id);

        $ownerToken->putJson($this->schedulePath($ownerSeeded['storefront']->id, $foreignVersion['id']), [
            'revision' => $foreignVersion['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $foreignVersion['schedule_token'],
        ])->assertStatus(404);
    }

    /** @test */
    public function same_tenant_cross_storefront_version_scheduling_is_a_safe_404(): void
    {
        $auth = $this->registerTenant('sched-iso-cross-store', 'owner@sched-iso-cross-store.test');
        $storeA = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'store-a', 'name' => 'أ']);
        $storeB = $this->seedWebStorefront($auth['tenant_id'], ['slug' => 'store-b', 'name' => 'ب']);
        $token = $this->withToken($auth['token']);

        $versionInB = $this->createDraft($token, $storeB['storefront']->id);

        $token->putJson($this->schedulePath($storeA['storefront']->id, $versionInB['id']), [
            'revision' => $versionInB['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $versionInB['schedule_token'],
        ])->assertStatus(404);
    }

    /** @test */
    public function canceling_a_foreign_storefronts_schedule_is_a_safe_404(): void
    {
        $ownerAuth = $this->registerTenant('cancel-iso-owner', 'owner@cancel-iso-owner.test');
        $seeded = $this->seedWebStorefront($ownerAuth['tenant_id']);
        $ownerToken = $this->withToken($ownerAuth['token']);
        $draft = $this->createDraft($ownerToken, $seeded['storefront']->id);

        $scheduled = $ownerToken->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertOk();

        $attackerAuth = $this->registerTenant('cancel-iso-attacker', 'owner@cancel-iso-attacker.test');
        $attackerToken = $this->withToken($attackerAuth['token']);

        $attackerToken->deleteJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'expected_schedule_token' => $scheduled->json('data.schedule_token'),
        ])->assertStatus(404);
    }

    /** @test */
    public function a_guest_is_unauthorized(): void
    {
        $auth = $this->registerTenant('sched-guest', 'owner@sched-guest.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        // بلا توكن — `auth:sanctum` يجب أن يرفض قبل أي وصول للمورد، بصرف
        // النظر عن وجوده؛ معرّف عشوائي يتجنّب تلويث `$this` بترويسة
        // `withToken` (تبقى مُثبَّتةً على كل طلب لاحق عبر نفس النسخة —
        // راجع نظيرها في `StorefrontPresentationVersionPublishApiTest`).
        $this->putJson($this->schedulePath($seeded['storefront']->id, (string) \Illuminate\Support\Str::uuid()), [
            'revision' => 1,
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => 'irrelevant',
        ])->assertUnauthorized();
    }

    /** @test */
    public function self_service_is_forbidden(): void
    {
        $auth = $this->registerTenant('sched-self-service', 'owner@sched-self-service.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $ownerToken = $this->withToken($auth['token']);
        $draft = $this->createDraft($ownerToken, $seeded['storefront']->id);

        $selfServiceToken = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self@sched-self-service.test');

        $this->withToken($selfServiceToken)->putJson($this->schedulePath($seeded['storefront']->id, $draft['id']), [
            'revision' => $draft['revision'],
            'scheduled_for' => $this->futureIso(),
            'expected_schedule_token' => $draft['schedule_token'],
        ])->assertStatus(403);
    }
}

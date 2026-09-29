<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\ScheduledPresentationDispatcher;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUST-H1-4 — مُرسِل النشر المجدول المستحقّ (`storefront-presentations:dispatch-due`).
 * مرجعها المعماري: `docs/plans/store/CUST-H1-ARCH-1-...md` §14.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationScheduleDispatcherTest
 */
class StorefrontPresentationScheduleDispatcherTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function listPath(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions';
    }

    private function schedulePath(string $id, string $versionId): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation/versions/'.$versionId.'/schedule';
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

    /** @return array{version_id: string, storefront_id: string} ينشئ ويجدول نسخة مستحقّة الآن فعلياً (وقتٌ ماضٍ مباشرة). */
    private function createDueVersion($token, string $storefrontId, string $name, int $minutesPastDue = 1): array
    {
        $created = $token->postJson($this->listPath($storefrontId), ['name' => $name])->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->schedulePath($storefrontId, $versionId), [
            'revision' => $created->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addMinutes(10)->toIso8601String(),
            'expected_schedule_token' => $created->json('data.schedule_token'),
        ])->assertOk();

        DB::table('storefront_presentation_versions')
            ->where('id', $versionId)
            ->update(['scheduled_for' => Carbon::now('UTC')->subMinutes($minutesPastDue)]);

        return ['version_id' => $versionId, 'storefront_id' => $storefrontId];
    }

    /** @return array{version_id: string, storefront_id: string} تجدل نسخة لوقتٍ مستقبلي — غير مستحقّة. */
    private function createFutureVersion($token, string $storefrontId, string $name): array
    {
        $created = $token->postJson($this->listPath($storefrontId), ['name' => $name])->assertCreated();
        $versionId = $created->json('data.id');

        $token->putJson($this->schedulePath($storefrontId, $versionId), [
            'revision' => $created->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addDays(3)->toIso8601String(),
            'expected_schedule_token' => $created->json('data.schedule_token'),
        ])->assertOk();

        return ['version_id' => $versionId, 'storefront_id' => $storefrontId];
    }

    // ───────────────────────── Selection ─────────────────────────

    /** @test */
    public function it_publishes_only_due_items_and_leaves_future_ones_untouched(): void
    {
        $auth = $this->registerTenant('disp-due-only', 'owner@disp-due-only.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $due = $this->createDueVersion($token, $seeded['storefront']->id, 'مستحقّة');

        $futureAuth = $this->registerTenant('disp-future', 'owner@disp-future.test');
        $futureSeeded = $this->seedWebStorefront($futureAuth['tenant_id']);
        $futureToken = $this->withToken($futureAuth['token']);
        $future = $this->createFutureVersion($futureToken, $futureSeeded['storefront']->id, 'مستقبلية');

        $summary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();

        $this->assertSame(1, $summary['due']);
        $this->assertSame(1, $summary['published']);
        $this->assertSame(0, $summary['failed']);

        $dueHead = $this->presentationHead($due['storefront_id']);
        $this->assertSame($due['version_id'], $dueHead->active_version_id);

        $futureHead = $this->presentationHead($future['storefront_id']);
        $this->assertNull($futureHead->active_version_id);
        $this->assertSame($future['version_id'], $futureHead->scheduled_version_id);
    }

    /** @test */
    public function repeat_dispatcher_runs_are_safe_and_do_not_republish(): void
    {
        $auth = $this->registerTenant('disp-repeat', 'owner@disp-repeat.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $this->createDueVersion($token, $seeded['storefront']->id, 'مرّة');

        $first = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();
        $this->assertSame(1, $first['published']);

        $headAfterFirst = $this->presentationHead($seeded['storefront']->id);

        $second = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();
        $this->assertSame(0, $second['due'], 'لا عنصر مستحقّ متبقٍّ بعد النشر — المؤشر أُزيل من الاستعلام (JOIN على scheduled_version_id).');

        $headAfterSecond = $this->presentationHead($seeded['storefront']->id);
        $this->assertSame((int) $headAfterFirst->published_revision, (int) $headAfterSecond->published_revision);
    }

    /** @test */
    public function stale_rows_are_harmless_across_repeated_runs(): void
    {
        $auth = $this->registerTenant('disp-stale-rows', 'owner@disp-stale-rows.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $a = $this->createDueVersion($token, $seeded['storefront']->id, 'أ');

        // ب تستبدل أ كمجدولة — سطر أ في الجدول قد يبقى بـ`scheduled_for` قديم
        // فنياً (لا مسار API يمسحه فوراً وقت الاستبدال العادي)، لكن الـJOIN
        // على مؤشر الرأس الحالي يستبعده تلقائياً من "المستحقّ" بمجرّد أن
        // يتحرّك المؤشر — لا حاجة لتقليم صريح.
        $bCreated = $token->postJson($this->listPath($seeded['storefront']->id), ['name' => 'ب'])->assertCreated();
        $listRes = $token->getJson($this->listPath($seeded['storefront']->id))->assertOk();
        $bRow = collect($listRes->json('data'))->firstWhere('id', $bCreated->json('data.id'));

        $token->putJson($this->schedulePath($seeded['storefront']->id, $bCreated->json('data.id')), [
            'revision' => $bCreated->json('data.revision'),
            'scheduled_for' => Carbon::now('UTC')->addDays(5)->toIso8601String(),
            'expected_schedule_token' => $bRow['schedule_token'],
        ])->assertOk();

        $summary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();

        $this->assertSame(0, $summary['due'], 'سطر أ اليتيم (scheduled_for ماضٍ لكنه لم يعد المجدول) لا يُعتبر مستحقّاً.');

        $head = $this->presentationHead($seeded['storefront']->id);
        $this->assertNull($head->active_version_id);
        $this->assertSame($bCreated->json('data.id'), $head->scheduled_version_id);
    }

    // ───────────────────────── Isolation & batching ─────────────────────────

    /** @test */
    public function one_item_failure_does_not_prevent_later_items_from_executing(): void
    {
        $failingAuth = $this->registerTenant('disp-fail-item', 'owner@disp-fail-item.test');
        $failingSeeded = $this->seedWebStorefront($failingAuth['tenant_id']);
        $failingToken = $this->withToken($failingAuth['token']);
        $failing = $this->createDueVersion($failingToken, $failingSeeded['storefront']->id, 'فاشلة', 5);

        // تُفسَد بعد الجدولة: مخطّطٌ أمامي يجعل تنفيذها يعود no-op (لا استثناء)
        // — يكفي لإثبات "عنصرٌ لا يُنتج published لا يمنع عنصراً آخر ناجحاً".
        DB::table('storefront_presentation_versions')
            ->where('id', $failing['version_id'])
            ->update(['schema_version' => \App\Support\Commerce\StorefrontPresentationNormalizer::VERSION + 1]);

        $healthyAuth = $this->registerTenant('disp-healthy-item', 'owner@disp-healthy-item.test');
        $healthySeeded = $this->seedWebStorefront($healthyAuth['tenant_id']);
        $healthyToken = $this->withToken($healthyAuth['token']);
        $healthy = $this->createDueVersion($healthyToken, $healthySeeded['storefront']->id, 'سليمة', 1);

        $summary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();

        $this->assertSame(2, $summary['due']);
        $this->assertSame(1, $summary['published']);

        $healthyHead = $this->presentationHead($healthy['storefront_id']);
        $this->assertSame($healthy['version_id'], $healthyHead->active_version_id, 'العنصر السليم نُشر رغم فشل العنصر الآخر في نفس الدفعة.');

        $failingHead = $this->presentationHead($failing['storefront_id']);
        $this->assertNull($failingHead->active_version_id);
        $this->assertSame($failing['version_id'], $failingHead->scheduled_version_id, 'العنصر الفاشل تبقى جدولته قابلة للتشخيص/إعادة المحاولة.');
    }

    /** @test */
    public function the_batch_is_bounded_by_limit(): void
    {
        // متجرٌ واحد لا يقبل أكثر من مجدولة واحدة في آنٍ (قيد معماري) — نستعمل
        // ثلاثة مستأجرين منفصلين كي نراكم أكثر من عنصر مستحقّ دفعةً واحدة.
        for ($i = 1; $i <= 3; $i++) {
            $a = $this->registerTenant("disp-bound-$i", "owner@disp-bound-$i.test");
            $s = $this->seedWebStorefront($a['tenant_id']);
            $t = $this->withToken($a['token']);
            $this->createDueVersion($t, $s['storefront']->id, 'محدودة');
        }

        $summary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch(2);

        $this->assertSame(2, $summary['due'], 'الدفعة محدودة بحجمها حتى لو وُجد مستحقٌّ أكثر.');

        $remainingSummary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch(2);
        $this->assertSame(1, $remainingSummary['due'], 'التشغيل التالي يلتقط ما تبقّى — لا فقدان.');
    }

    /** @test */
    public function no_cross_tenant_leakage_across_a_mixed_batch(): void
    {
        $authA = $this->registerTenant('disp-tenant-a', 'owner@disp-tenant-a.test');
        $seededA = $this->seedWebStorefront($authA['tenant_id']);
        $tokenA = $this->withToken($authA['token']);
        $dueA = $this->createDueVersion($tokenA, $seededA['storefront']->id, 'أ');

        $authB = $this->registerTenant('disp-tenant-b', 'owner@disp-tenant-b.test');
        $seededB = $this->seedWebStorefront($authB['tenant_id']);
        $tokenB = $this->withToken($authB['token']);
        $dueB = $this->createDueVersion($tokenB, $seededB['storefront']->id, 'ب');

        app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();

        $headA = $this->presentationHead($dueA['storefront_id']);
        $headB = $this->presentationHead($dueB['storefront_id']);

        $this->assertSame($dueA['version_id'], $headA->active_version_id);
        $this->assertSame($dueB['version_id'], $headB->active_version_id);

        // كل رأسٍ يحمل tenant_id الصحيح فقط — لا تسريب حالة بين المستأجرين.
        $this->assertSame($authA['tenant_id'], StorefrontPresentation::withoutGlobalScopes()->find($headA->id)->tenant_id);
        $this->assertSame($authB['tenant_id'], StorefrontPresentation::withoutGlobalScopes()->find($headB->id)->tenant_id);
    }

    /** @test */
    public function downtime_recovery_publishes_items_that_became_due_while_the_dispatcher_was_not_running(): void
    {
        $auth = $this->registerTenant('disp-downtime', 'owner@disp-downtime.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // مستحقّة منذ "ساعات" — تحاكي مُرسِلاً لم يُشغَّل لفترة طويلة.
        $overdue = $this->createDueVersion($token, $seeded['storefront']->id, 'متأخرة جداً', 180);

        $summary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();

        $this->assertSame(1, $summary['published']);
        $head = $this->presentationHead($overdue['storefront_id']);
        $this->assertSame($overdue['version_id'], $head->active_version_id);
    }

    // ───────────────────────── Console wiring ─────────────────────────

    /** @test */
    public function the_console_command_dispatches_due_items(): void
    {
        $auth = $this->registerTenant('disp-console', 'owner@disp-console.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $due = $this->createDueVersion($token, $seeded['storefront']->id, 'من الأمر');

        $exitCode = \Illuminate\Support\Facades\Artisan::call('storefront-presentations:dispatch-due');

        $this->assertSame(0, $exitCode);
        $this->assertStringContainsString(
            'due=1 published=1',
            \Illuminate\Support\Facades\Artisan::output(),
        );

        $head = $this->presentationHead($due['storefront_id']);
        $this->assertSame($due['version_id'], $head->active_version_id);
    }
}

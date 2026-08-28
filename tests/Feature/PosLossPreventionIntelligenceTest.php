<?php

namespace Tests\Feature;

use App\Models\PosException;
use App\Models\PosExceptionReview;
use App\Models\PosExceptionRule;
use App\Models\PosRiskSnapshot;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Services\Pos\PosExceptionDetectionService;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 2 — الذكاء الرقابي: المحرّك الحتمي، خطوط الأساس، الدرجة المفسَّرة،
 * المبلغ قيد المراجعة وإزالة ازدواجه، دورة المراجعة، والعزل وRBAC والترقيم.
 */
class PosLossPreventionIntelligenceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sessionSequence = 0;

    private function cashier(string $tenantId, string $email): User
    {
        app(TenantContext::class)->set($tenantId);

        return User::create([
            'tenant_id' => $tenantId, 'name' => 'كاشير ' . Str::random(4),
            'email' => $email, 'password' => 'password123', 'role' => 'staff',
        ]);
    }

    private function posSession(string $tenantId, string $ownerId, ?Carbon $openedAt = null, ?Carbon $closedAt = null): PosSession
    {
        $number = 'POS-TEST-' . (++$this->sessionSequence);
        $openedAt ??= Carbon::now()->subDays(1);
        // تُغلق افتراضياً: فهرس جزئي فريد يسمح بجلسة مفتوحة واحدة بلا جهاز لكل
        // مستأجر، فالاختبارات التي تنشئ عدة جلسات تحتاجها مغلقة (لا يؤثر في الكشف).
        $closedAt ??= $openedAt->copy()->addHours(8);

        return PosSession::create([
            'tenant_id' => $tenantId, 'branch_id' => null, 'number' => $number,
            'status' => 'closed', 'opening_balance' => 0,
            'opened_at' => $openedAt, 'closed_at' => $closedAt, 'opened_by' => $ownerId,
        ]);
    }

    /** يزرع حدث دليل مباشرةً (evidence)؛ الكشف يقرأه ولا يعدّله. */
    private function event(string $tenantId, string $sessionId, string $performerId, string $type, array $opts = []): void
    {
        PosSessionEvent::create([
            'tenant_id' => $tenantId,
            'branch_id' => $opts['branch_id'] ?? null,
            'pos_session_id' => $sessionId,
            'cart_id' => $opts['cart_id'] ?? null,
            'type' => $type,
            'category' => $opts['category'] ?? 'test',
            'actor_id' => $performerId,
            'performed_by' => $performerId,
            'approved_by' => $opts['approved_by'] ?? null,
            'amount' => $opts['amount'] ?? null,
            'payload' => ['provenance' => ['source' => $opts['source'] ?? 'server', 'trust_level' => 'server_authoritative']],
            'created_at' => $opts['at'] ?? Carbon::now()->subDays(1),
        ]);
    }

    private function repeat(int $times, callable $fn): void
    {
        for ($i = 0; $i < $times; $i++) {
            $fn($i);
        }
    }

    private function detect(string $tenantId, ?Carbon $now = null): array
    {
        app(TenantContext::class)->set($tenantId);

        return app(PosExceptionDetectionService::class)->run($now);
    }

    private function exceptionsFor(string $ruleKey, ?string $subject = null)
    {
        return PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('rule_key', $ruleKey)
            ->when($subject, fn ($q) => $q->where('subject_user_id', $subject))
            ->get();
    }

    // ═══════════════════════ المقاييس المطبّعة ═══════════════════════

    /** @test */
    public function item_removal_normalized_rate_triggers_against_static_fallback_and_is_labeled_client_observed(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'removal@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));

        $this->detect($tenant);

        $exception = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        // 30 لكل 100 = 30000 milli، والمقام 100 صنف مُضاف.
        $this->assertSame(30000, $exception->observed_rate_milli);
        $this->assertSame(100, $exception->denominator);
        $this->assertSame(30, $exception->observed_count);
        $this->assertSame('client_observed', $exception->evidence_confidence);
        $this->assertSame('client_observed', $exception->explanation['confidence']);
        $this->assertContains($exception->baseline_type, ['static', 'peer', 'self']);
    }

    /** @test */
    public function cart_cancellation_normalized_rate_is_computed_from_created_carts(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'cancel@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(20, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CREATED));
        $this->repeat(8, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CANCELLED, ['source' => 'client_observed']));

        $this->detect($tenant);

        $exception = $this->exceptionsFor('cart_cancellation_rate', $cashier->id)->sole();
        $this->assertSame(40000, $exception->observed_rate_milli); // 8/20 لكل 100 = 40
        $this->assertSame(20, $exception->denominator);
    }

    /** @test */
    public function zero_denominator_and_insufficient_sample_do_not_produce_misleading_exceptions(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'lowvol@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        // إزالات بلا أي صنف مُضاف (مقام صفر) + عينة أقل من الحد الأدنى.
        $this->repeat(5, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));

        $summary = $this->detect($tenant);

        $this->assertSame(0, $this->exceptionsFor('item_removal_rate', $cashier->id)->count());
        $this->assertIsInt($summary['exceptions']);
    }

    // ═══════════════════════ خطوط الأساس ═══════════════════════

    /** @test */
    public function self_baseline_is_used_when_the_subject_has_sufficient_own_history(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'self@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        // النافذة السابقة (45 يوماً): معدّل منخفض 5 لكل 100.
        $prior = Carbon::now()->subDays(45);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed', 'at' => $prior]));
        $this->repeat(5, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed', 'at' => $prior]));
        // النافذة الحالية: معدّل مرتفع 20 لكل 100.
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(20, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));

        $this->detect($tenant);

        $exception = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        $this->assertSame('self', $exception->baseline_type);
        $this->assertSame(5000, $exception->baseline_rate_milli);
    }

    /** @test */
    public function peer_baseline_is_used_with_a_sufficient_comparable_population(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $subject = $this->cashier($tenant, 'peer-subject@x.test');
        $subjectSession = $this->posSession($tenant, $subject->id);
        $this->repeat(100, fn () => $this->event($tenant, $subjectSession->id, $subject->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(20, fn () => $this->event($tenant, $subjectSession->id, $subject->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        // ثلاثة نظراء بمعدّل منخفض 5 لكل 100.
        foreach (['p1', 'p2', 'p3'] as $i => $slug) {
            $peer = $this->cashier($tenant, "peer-$slug@x.test");
            $peerSession = $this->posSession($tenant, $peer->id);
            $this->repeat(100, fn () => $this->event($tenant, $peerSession->id, $peer->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
            $this->repeat(5, fn () => $this->event($tenant, $peerSession->id, $peer->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        }

        $this->detect($tenant);

        $exception = $this->exceptionsFor('item_removal_rate', $subject->id)->sole();
        $this->assertSame('peer', $exception->baseline_type);
        $this->assertSame(5000, $exception->baseline_rate_milli);
        // النظراء أنفسهم لا يتجاوزون أساسهم فلا استثناء لهم.
        $this->assertSame(1, $this->exceptionsFor('item_removal_rate')->count());
    }

    // ═══════════════════════ المرتجعات والمبلغ قيد المراجعة ═══════════════════════

    /** @test */
    public function refund_metrics_use_authoritative_evidence_and_expose_amount_under_review(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'refund@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(20, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CHECKOUT_COMPLETED, ['amount' => 100000]));
        $this->repeat(5, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_RETURN_RECORDED, ['amount' => 60000]));

        $this->detect($tenant);

        $frequency = $this->exceptionsFor('refund_frequency', $cashier->id)->sole();
        $this->assertSame('server_authoritative', $frequency->evidence_confidence);
        $this->assertSame(0, (int) $frequency->amount_under_review); // التواتر بلا مبلغ

        $amountRule = $this->exceptionsFor('refund_amount_rate', $cashier->id)->sole();
        $this->assertSame(300000, (int) $amountRule->amount_under_review); // 5×60000
        $this->assertCount(5, $amountRule->amount_event_ids);
    }

    /** @test */
    public function closing_variance_magnitude_and_frequency_rules_fire_on_session_evidence(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'variance@x.test');
        $sessions = [];
        $this->repeat(5, function () use ($tenant, $cashier, &$sessions) {
            $sessions[] = $this->posSession($tenant, $cashier->id, Carbon::now()->subDays(2), Carbon::now()->subDays(2)->addHours(6));
        });
        // ثلاث جلسات بفرق إغلاق كبير.
        foreach (array_slice($sessions, 0, 3) as $session) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT, ['amount' => 20000, 'at' => Carbon::now()->subDays(2)]);
        }

        $this->detect($tenant);

        $magnitude = $this->exceptionsFor('closing_variance_magnitude', $cashier->id)->sole();
        $this->assertSame(60000, (int) $magnitude->amount_under_review); // 3×20000
        $this->assertCount(3, $magnitude->amount_event_ids);
        $frequency = $this->exceptionsFor('closing_variance_frequency', $cashier->id)->sole();
        $this->assertSame(60000, $frequency->observed_rate_milli); // 3/5 لكل 100
    }

    /** @test */
    public function recount_pattern_rule_fires_on_session_evidence(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'recount@x.test');
        $sessions = [];
        $this->repeat(5, function () use ($tenant, $cashier, &$sessions) {
            $sessions[] = $this->posSession($tenant, $cashier->id, Carbon::now()->subDays(2), Carbon::now()->subDays(2)->addHours(5));
        });
        foreach (array_slice($sessions, 0, 3) as $session) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CLOSING_COUNT_RECOUNTED, ['at' => Carbon::now()->subDays(2)]);
        }

        $this->detect($tenant);

        $this->assertSame(1, $this->exceptionsFor('recount_usage_rate', $cashier->id)->count());
    }

    // ═══════════════════════ الاعتماد ═══════════════════════

    /** @test */
    public function same_performer_approver_concentration_rule_fires(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $performer = $this->cashier($tenant, 'perf@x.test');
        $approver = $this->cashier($tenant, 'appr@x.test');
        $session = $this->posSession($tenant, $performer->id, Carbon::now()->subDays(3));
        $this->repeat(5, fn () => $this->event($tenant, $session->id, $performer->id, PosSessionEvent::TYPE_OVERRIDE_APPROVED, [
            'approved_by' => $approver->id, 'at' => Carbon::now()->subDays(3),
        ]));

        $this->detect($tenant);

        $exception = $this->exceptionsFor('performer_approver_pair_concentration', $performer->id)->sole();
        $this->assertSame($approver->id, $exception->approved_by);
        $this->assertSame(100000, $exception->observed_rate_milli); // 5/5 = 100%
        $this->assertSame(PosException::SEVERITY_PRIORITY, $exception->severity);
    }

    // ═══════════════════════ الدرجة والأسقف ═══════════════════════

    /** @test */
    public function score_components_are_capped_per_category_and_overall(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'score@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        // يشعل عدة قواعد سلة (نفس الفئة) بمعدّلات عالية جداً.
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CREATED));
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(90, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->repeat(80, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_PRICE_OVERRIDDEN, ['source' => 'client_observed']));
        $this->repeat(80, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_DISCOUNT_APPLIED, ['source' => 'client_observed']));
        $this->repeat(70, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CANCELLED, ['source' => 'client_observed']));

        $this->detect($tenant);

        $snapshot = PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)->where('subject_user_id', $cashier->id)->sole();
        $this->assertLessThanOrEqual(100, $snapshot->total_score);
        $this->assertLessThanOrEqual(30, $snapshot->components['cart']['points']);
        // النقاط الخام قبل السقف أعلى من المسقوف — دليل أن السقف فعّال.
        $this->assertGreaterThanOrEqual($snapshot->components['cart']['points'], $snapshot->components['cart']['raw_points']);
    }

    /** @test */
    public function amount_under_review_avoids_double_counting_the_same_event(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'aur@x.test');
        $sessions = [];
        $this->repeat(5, function () use ($tenant, $cashier, &$sessions) {
            $sessions[] = $this->posSession($tenant, $cashier->id, Carbon::now()->subDays(2), Carbon::now()->subDays(2)->addHours(6));
        });
        foreach (array_slice($sessions, 0, 3) as $session) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT, ['amount' => 20000, 'at' => Carbon::now()->subDays(2)]);
        }

        $this->detect($tenant);

        // كل من magnitude وfrequency يشير لأحداث الفرق نفسها، لكن المبلغ يُحتسب مرة.
        $snapshot = PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)->where('subject_user_id', $cashier->id)->sole();
        $this->assertSame(60000, (int) $snapshot->amount_under_review); // ليس 120000
    }

    // ═══════════════════════ الإدامة (idempotency) والتاريخ ═══════════════════════

    /** @test */
    public function rerunning_detection_is_idempotent_and_does_not_duplicate_exceptions(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'idem@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));

        $this->detect($tenant);
        $first = PosException::query()->withoutGlobalScope(BranchScope::class)->count();
        $this->detect($tenant);
        $second = PosException::query()->withoutGlobalScope(BranchScope::class)->count();

        $this->assertSame($first, $second);
        $this->assertSame(1, $this->exceptionsFor('item_removal_rate', $cashier->id)->count());
    }

    /** @test */
    public function disabling_a_rule_does_not_delete_historical_exceptions(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'disable@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);
        $this->assertSame(1, $this->exceptionsFor('item_removal_rate', $cashier->id)->count());

        app(TenantContext::class)->set($tenant);
        PosExceptionRule::query()->where('rule_key', 'item_removal_rate')->update(['is_enabled' => false]);
        $this->detect($tenant);

        $this->assertSame(1, $this->exceptionsFor('item_removal_rate', $cashier->id)->count());
    }

    /** @test */
    public function changing_a_rule_setting_does_not_rewrite_the_historical_rule_snapshot(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'snap@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);
        $original = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        $originalVersion = $original->rule_version;
        $originalThreshold = $original->rule_snapshot['threshold'];

        app(TenantContext::class)->set($tenant);
        PosExceptionRule::query()->where('rule_key', 'item_removal_rate')->update(['threshold' => 999, 'version' => $originalVersion + 5]);
        $this->detect($tenant);

        $after = PosException::query()->withoutGlobalScope(BranchScope::class)->find($original->id);
        $this->assertSame($originalVersion, $after->rule_version);
        $this->assertSame($originalThreshold, $after->rule_snapshot['threshold']);
    }

    // ═══════════════════════ دورة المراجعة ═══════════════════════

    /** @test */
    public function review_lifecycle_records_reviewer_time_reason_and_preserves_history_without_touching_evidence(): void
    {
        $owner = $this->registerTenant();
        $tenant = $owner['tenant_id'];
        $cashier = $this->cashier($tenant, 'reviewed@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);
        $exception = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        $evidenceCount = PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)->count();

        $reviewer = $this->tokenForRole($tenant, 'admin', 'reviewer@x.test');
        $this->withToken($reviewer)->postJson("/api/pos/audit/exceptions/{$exception->id}/review", ['to_state' => 'reviewing'])->assertOk();
        $this->withToken($reviewer)->postJson("/api/pos/audit/exceptions/{$exception->id}/review", [
            'to_state' => 'explained', 'reason' => 'operational', 'note' => 'سبب تشغيلي معروف',
        ])->assertOk()->assertJsonPath('data.review_state', 'explained');

        $fresh = PosException::query()->withoutGlobalScope(BranchScope::class)->find($exception->id);
        $this->assertSame('explained', $fresh->review_state);
        $this->assertNotNull($fresh->reviewed_by);
        $this->assertNotNull($fresh->reviewed_at);
        $this->assertSame(2, PosExceptionReview::query()->withoutGlobalScope(BranchScope::class)->where('pos_exception_id', $exception->id)->count());
        // الدليل الأصلي لم يُمَسّ.
        $this->assertSame($evidenceCount, PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)->count());
    }

    /** @test */
    public function review_history_rows_are_append_only(): void
    {
        $owner = $this->registerTenant();
        $tenant = $owner['tenant_id'];
        app(TenantContext::class)->set($tenant);
        $cashier = $this->cashier($tenant, 'append@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);
        $exception = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        $reviewer = $this->tokenForRole($tenant, 'admin', 'append-rev@x.test');
        $this->withToken($reviewer)->postJson("/api/pos/audit/exceptions/{$exception->id}/review", ['to_state' => 'reviewing'])->assertOk();
        $review = PosExceptionReview::query()->withoutGlobalScope(BranchScope::class)->first();

        try { $review->update(['note' => 'x']); $this->fail('سجلّ المراجعة يجب أن يرفض update.'); }
        catch (\LogicException) { $this->assertTrue(true); }
        try { $review->delete(); $this->fail('سجلّ المراجعة يجب أن يرفض delete.'); }
        catch (\LogicException) { $this->assertTrue(true); }
    }

    // ═══════════════════════ العزل وRBAC ═══════════════════════

    /** @test */
    public function tenant_isolation_prevents_seeing_another_tenants_exceptions_and_scores(): void
    {
        $first = $this->registerTenant();
        $tenant = $first['tenant_id'];
        $cashier = $this->cashier($tenant, 'iso@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);

        $second = $this->registerTenant('second-lp', 'second-lp@x.test');
        $this->withToken($second['token'])->getJson('/api/pos/audit/exceptions')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($second['token'])->getJson('/api/pos/audit/risk')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function intelligence_apis_require_pos_audit_view(): void
    {
        $auth = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-lp@x.test');
        $this->withToken($staff)->getJson('/api/pos/audit/exceptions')->assertForbidden();
        $this->withToken($staff)->getJson('/api/pos/audit/risk')->assertForbidden();
        $this->withToken($staff)->getJson('/api/pos/audit/intelligence/overview')->assertForbidden();
    }

    /** @test */
    public function review_requires_review_permission_and_settings_change_requires_settings_permission(): void
    {
        $owner = $this->registerTenant();
        $tenant = $owner['tenant_id'];
        $cashier = $this->cashier($tenant, 'rbac@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);
        $exception = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();

        // staff لديه عرض؟ لا — staff ليس لديه pos.audit.view. نستخدم دوراً مخصصاً.
        $viewer = $this->tokenForRole($tenant, 'staff', 'viewer-only@x.test');
        $this->withToken($viewer)->postJson("/api/pos/audit/exceptions/{$exception->id}/review", ['to_state' => 'reviewing'])->assertForbidden();
        $this->withToken($viewer)->putJson('/api/pos/audit/rules/item_removal_rate', ['is_enabled' => false])->assertForbidden();
        $this->withToken($viewer)->postJson('/api/pos/audit/recalculate')->assertForbidden();
    }

    /** @test */
    public function client_cannot_forge_risk_score_or_severity_through_review(): void
    {
        $owner = $this->registerTenant();
        $tenant = $owner['tenant_id'];
        $cashier = $this->cashier($tenant, 'forge@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(30, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->detect($tenant);
        $exception = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        $originalSeverity = $exception->severity;
        $originalContribution = $exception->risk_contribution;

        $reviewer = $this->tokenForRole($tenant, 'admin', 'forge-rev@x.test');
        $this->withToken($reviewer)->postJson("/api/pos/audit/exceptions/{$exception->id}/review", [
            'to_state' => 'reviewing', 'severity' => 'priority', 'risk_contribution' => 999, 'amount_under_review' => 999999,
        ])->assertOk();

        $fresh = PosException::query()->withoutGlobalScope(BranchScope::class)->find($exception->id);
        $this->assertSame($originalSeverity, $fresh->severity);
        $this->assertSame($originalContribution, $fresh->risk_contribution);
    }

    // ═══════════════════════ الترقيم الخادمي ═══════════════════════

    /** @test */
    public function exception_list_paginates_server_side_with_a_correct_total(): void
    {
        $owner = $this->registerTenant();
        $tenant = $owner['tenant_id'];
        // يشعل قواعد متعددة لإنتاج عدة استثناءات.
        $cashier = $this->cashier($tenant, 'page@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CART_CREATED));
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(90, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));
        $this->repeat(80, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_PRICE_OVERRIDDEN, ['source' => 'client_observed']));
        $this->repeat(80, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_DISCOUNT_APPLIED, ['source' => 'client_observed']));
        $this->detect($tenant);

        $total = PosException::query()->withoutGlobalScope(BranchScope::class)->count();
        $this->assertGreaterThanOrEqual(3, $total);
        $response = $this->withToken($owner['token'])->getJson('/api/pos/audit/exceptions?per_page=2&page=1')->assertOk();
        $response->assertJsonPath('meta.total', $total)->assertJsonCount(2, 'data');
    }

    // ═══════════════════════ اختبارات انحدار مراجعة Codex ═══════════════════════

    /** @test P1: قيمة الاستبدال تُشتق خادمياً وتغذّي refund_amount_rate والمبلغ قيد المراجعة. */
    public function exchange_recording_carries_server_amount_and_feeds_refund_amount_metrics(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        app(TenantContext::class)->set($tenant);
        $owner = User::query()->where('email', 'owner@acme.test')->firstOrFail();

        // مسار الكتابة الحقيقي: recordExchange يجب أن يسم الحدث بمبلغ = الرصيد المطبّق + النقد المصروف.
        $open = PosSession::create([
            'tenant_id' => $tenant, 'branch_id' => null, 'number' => 'POS-EX-OPEN', 'status' => 'open',
            'opening_balance' => 0, 'opened_at' => Carbon::now()->subHours(2), 'opened_by' => $owner->id,
        ]);
        // recordExchange يقرأ خصائص الاستبدال فقط (لا يحتاج صفاً محفوظاً)، فنتفادى
        // قيود مستند فاتورة/مرتجع كاملة غير المعنيّة بهذا الاختبار الرقابي.
        $exchange = new \App\Models\PosExchange([
            'pos_session_id' => $open->id, 'status' => 'posted',
            'applied_credit_amount' => 40000, 'cash_refund_amount' => 20000,
        ]);
        $exchange->id = (string) Str::uuid();
        $exchange->tenant_id = $tenant;
        app(\App\Services\Accounting\PosSessionService::class)->recordExchange($open, $exchange, $owner);
        $exchangeEvent = PosSessionEvent::query()->withoutGlobalScope(BranchScope::class)
            ->where('type', PosSessionEvent::TYPE_EXCHANGE_RECORDED)->sole();
        $this->assertSame(60000, (int) $exchangeEvent->amount);
        $this->assertSame(40000, (int) $exchangeEvent->payload['applied_credit_amount']);

        // الكشف: مبيعات + استبدالات بقيم فعلية تتجاوز عتبة نسبة مبلغ المرتجع.
        $closed = $this->posSession($tenant, $owner->id);
        $this->repeat(20, fn () => $this->event($tenant, $closed->id, $owner->id, PosSessionEvent::TYPE_CHECKOUT_COMPLETED, ['amount' => 100000]));
        $this->repeat(4, fn () => $this->event($tenant, $closed->id, $owner->id, PosSessionEvent::TYPE_EXCHANGE_RECORDED, ['amount' => 60000]));

        // نهاية النافذة بعد لحظة إنشاء حدث recordExchange الحيّ (الحدّ `< now`).
        $this->detect($tenant, Carbon::now()->addMinute());

        $amountRule = $this->exceptionsFor('refund_amount_rate', $owner->id)->sole();
        // 5 استبدالات × 60000 = 300000 قيمة إرجاع فعلية (لا صفر، ولا اختلاق، ولا ازدواج).
        $this->assertSame(300000, (int) $amountRule->amount_under_review);
        $this->assertCount(5, $amountRule->amount_event_ids);
    }

    /** @test P1: تنظيف اللقطات القديمة يجب أن يكون بهوية (فرع+موضوع) لا الموضوع وحده. */
    public function stale_snapshot_cleanup_is_scoped_by_branch_and_subject(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        app(TenantContext::class)->set($tenant);
        $branchA = \App\Models\Branch::create(['tenant_id' => $tenant, 'code' => 'BR-A', 'name' => 'فرع أ']);
        $branchB = \App\Models\Branch::create(['tenant_id' => $tenant, 'code' => 'BR-B', 'name' => 'فرع ب']);
        $user = $this->cashier($tenant, 'multibranch@x.test');

        // دليل حقيقي يوسم المستخدم في الفرع أ فقط.
        $session = PosSession::create([
            'tenant_id' => $tenant, 'branch_id' => $branchA->id, 'number' => 'POS-BRA', 'status' => 'closed',
            'opening_balance' => 0, 'opened_at' => Carbon::now()->subDays(1), 'closed_at' => Carbon::now()->subDays(1)->addHours(6), 'opened_by' => $user->id,
        ]);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $user->id, PosSessionEvent::TYPE_ITEM_ADDED, ['branch_id' => $branchA->id, 'source' => 'client_observed']));
        $this->repeat(40, fn () => $this->event($tenant, $session->id, $user->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['branch_id' => $branchA->id, 'source' => 'client_observed']));

        // لقطة قديمة لنفس المستخدم في الفرع ب (لم يعد موسوماً فيه).
        PosRiskSnapshot::create([
            'tenant_id' => $tenant, 'branch_id' => $branchB->id, 'scope' => 'user', 'subject_user_id' => $user->id,
            'total_score' => 80, 'band' => 'priority', 'exception_count' => 3, 'amount_under_review' => 500000,
            'sample_size' => 50, 'sample_sufficient' => true, 'components' => [], 'calculated_at' => Carbon::now()->subDay(),
        ]);

        $this->detect($tenant);

        // الفرع أ: لقطة حيّة. الفرع ب: أُزيلت رغم أن الموضوع نفسه ما زال موسوماً في أ.
        $this->assertTrue(PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)
            ->where('branch_id', $branchA->id)->where('subject_user_id', $user->id)->exists());
        $this->assertFalse(PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)
            ->where('branch_id', $branchB->id)->where('subject_user_id', $user->id)->exists());
    }

    /** @test P2: near_close_concentration يشتعل عند تركّز العمليات قرب الإغلاق ولا يشتعل بعيداً عنه. */
    public function near_close_concentration_triggers_only_when_sensitive_ops_cluster_before_close(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];

        // مستخدم أ: 12 عملية حساسة كلها خلال 10 دقائق قبل الإغلاق ⇒ يشتعل.
        $near = $this->cashier($tenant, 'near@x.test');
        $closeAt = Carbon::now()->subDays(1);
        $nearSession = PosSession::create([
            'tenant_id' => $tenant, 'branch_id' => null, 'number' => 'POS-NEAR', 'status' => 'closed',
            'opening_balance' => 0, 'opened_at' => $closeAt->copy()->subHours(6), 'closed_at' => $closeAt, 'opened_by' => $near->id,
        ]);
        $this->repeat(12, fn () => $this->event($tenant, $nearSession->id, $near->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['at' => $closeAt->copy()->subMinutes(10), 'source' => 'client_observed']));

        // مستخدم ب: 12 عملية حساسة قبل الإغلاق بساعتين ⇒ لا يشتعل.
        $far = $this->cashier($tenant, 'far@x.test');
        $farSession = PosSession::create([
            'tenant_id' => $tenant, 'branch_id' => null, 'number' => 'POS-FAR', 'status' => 'closed',
            'opening_balance' => 0, 'opened_at' => $closeAt->copy()->subHours(6), 'closed_at' => $closeAt, 'opened_by' => $far->id,
        ]);
        $this->repeat(12, fn () => $this->event($tenant, $farSession->id, $far->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['at' => $closeAt->copy()->subHours(2), 'source' => 'client_observed']));

        $this->detect($tenant);

        $this->assertSame(1, $this->exceptionsFor('near_close_concentration', $near->id)->count());
        $this->assertSame(0, $this->exceptionsFor('near_close_concentration', $far->id)->count());
    }

    /** @test P2: تغيير إصدار القاعدة ينشئ استثناءً بهوية جديدة ويُبقي القديم مجمّداً ومتّسقاً. */
    public function bumping_rule_version_creates_a_new_exception_and_freezes_the_old_one(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'version@x.test');
        $session = $this->posSession($tenant, $cashier->id);
        $this->repeat(100, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_ADDED, ['source' => 'client_observed']));
        $this->repeat(40, fn () => $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_ITEM_REMOVED, ['source' => 'client_observed']));

        $this->detect($tenant);
        $v1 = $this->exceptionsFor('item_removal_rate', $cashier->id)->sole();
        $originalContribution = $v1->risk_contribution;
        $this->assertSame(1, $v1->rule_version);
        $this->assertSame(12, $v1->rule_snapshot['weight']);

        // مضاعفة الوزن ورفع الإصدار (كما يفعل updateRule عند تغيير الضبط).
        app(TenantContext::class)->set($tenant);
        PosExceptionRule::query()->where('rule_key', 'item_removal_rate')->update(['weight' => 24, 'version' => 2]);

        $this->detect($tenant);

        // القديم (v1) مجمّد: نفس المساهمة واللقطة والإصدار — لا مقاييس بإعداد جديد فوق لقطة قديمة.
        $frozen = PosException::query()->withoutGlobalScope(BranchScope::class)->find($v1->id);
        $this->assertSame(1, $frozen->rule_version);
        $this->assertSame(12, $frozen->rule_snapshot['weight']);
        $this->assertSame($originalContribution, $frozen->risk_contribution);

        // الجديد (v2): هوية مستقلة، مساهمة مبنية على الوزن الجديد ولقطته توافقه.
        $v2 = PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('rule_key', 'item_removal_rate')->where('rule_version', 2)->sole();
        $this->assertNotSame($v1->id, $v2->id);
        $this->assertSame(24, $v2->rule_snapshot['weight']);
        $this->assertGreaterThan($originalContribution, $v2->risk_contribution);

        // اللقطة تعكس الإصدار الجديد.
        $snapshot = PosRiskSnapshot::query()->withoutGlobalScope(BranchScope::class)->where('subject_user_id', $cashier->id)->sole();
        $this->assertSame($v2->risk_contribution, $snapshot->components['cart']['raw_points']);
    }

    /** @test P2: قائمة السلال المفلترة تشتق آخر حدث من نفس المجموعة المفلترة. */
    public function filtered_cart_list_derives_latest_event_from_the_same_filtered_set(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        app(TenantContext::class)->set($tenant);
        $cashier = $this->cashier($tenant, 'carts@x.test');
        $sessionOne = $this->posSession($tenant, $cashier->id);
        $sessionTwo = PosSession::create([
            'tenant_id' => $tenant, 'branch_id' => null, 'number' => 'POS-CART2', 'status' => 'closed',
            'opening_balance' => 0, 'opened_at' => Carbon::now()->subHours(3), 'closed_at' => Carbon::now()->subHours(1), 'opened_by' => $cashier->id,
        ]);
        $cart = (string) Str::uuid();
        $early = Carbon::now()->subHours(5);
        $late = Carbon::now()->subMinutes(30);
        $this->event($tenant, $sessionOne->id, $cashier->id, PosSessionEvent::TYPE_CART_CREATED, ['cart_id' => $cart, 'at' => $early]);
        // حدث لاحق لنفس السلة في جلسة أخرى وخارج المدى.
        $this->event($tenant, $sessionTwo->id, $cashier->id, PosSessionEvent::TYPE_CART_CANCELLED, ['cart_id' => $cart, 'at' => $late, 'source' => 'client_observed']);

        // تصفية بالجلسة الأولى: آخر حدث يجب أن يكون من الجلسة الأولى لا الثانية.
        $bySession = $this->withToken($auth['token'])->getJson("/api/pos/audit/carts?pos_session_id={$sessionOne->id}")->assertOk();
        $bySession->assertJsonPath('data.0.pos_session_id', $sessionOne->id);
        $bySession->assertJsonPath('data.0.last_event_type', PosSessionEvent::TYPE_CART_CREATED);
        $bySession->assertJsonPath('data.0.event_count', 1);

        // تصفية زمنية تستبعد الحدث اللاحق: آخر حدث هو الأول لا الإلغاء.
        $to = $early->copy()->addHour()->toDateTimeString();
        $byDate = $this->withToken($auth['token'])->getJson('/api/pos/audit/carts?to=' . urlencode($to))->assertOk();
        $byDate->assertJsonPath('data.0.last_event_type', PosSessionEvent::TYPE_CART_CREATED);
        $byDate->assertJsonPath('data.0.event_count', 1);
    }

    /** @test P2: closing_variance_magnitude يستخدم العتبة المخزّنة القابلة للضبط لا رقماً ثابتاً. */
    public function closing_variance_magnitude_honors_the_tunable_threshold(): void
    {
        $auth = $this->registerTenant();
        $tenant = $auth['tenant_id'];
        $cashier = $this->cashier($tenant, 'magthreshold@x.test');
        $sessions = [];
        $this->repeat(4, function () use ($tenant, $cashier, &$sessions) {
            $sessions[] = $this->posSession($tenant, $cashier->id, Carbon::now()->subDays(2), Carbon::now()->subDays(2)->addHours(6));
        });
        // متوسط الفرق = 10000 هللة لكل جلسة.
        foreach ($sessions as $session) {
            $this->event($tenant, $session->id, $cashier->id, PosSessionEvent::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT, ['amount' => 10000, 'at' => Carbon::now()->subDays(2)]);
        }

        // التشغيل الأول (العتبة الافتراضية 5000) يزرع صفوف القواعد ويشتعل.
        $this->detect($tenant);
        $default = $this->exceptionsFor('closing_variance_magnitude', $cashier->id)->sole();
        $this->assertSame(5000, $default->baseline_rate_milli);

        // رفع العتبة فوق المتوسط ⇒ إصدار جديد لا يشتعل (لو كان الرقم ثابتاً 5000 لاشتعل).
        app(TenantContext::class)->set($tenant);
        PosExceptionRule::query()->where('rule_key', 'closing_variance_magnitude')->update(['threshold' => 20000, 'version' => 2]);
        $this->detect($tenant);
        $this->assertSame(0, PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('rule_key', 'closing_variance_magnitude')->where('rule_version', 2)->count());

        // خفض العتبة تحت المتوسط ⇒ يشتعل، فالكشف يستهلك العتبة المخزّنة فعلاً.
        app(TenantContext::class)->set($tenant);
        PosExceptionRule::query()->where('rule_key', 'closing_variance_magnitude')->update(['threshold' => 8000, 'version' => 3]);
        $this->detect($tenant);
        $fired = PosException::query()->withoutGlobalScope(BranchScope::class)
            ->where('rule_key', 'closing_variance_magnitude')->where('rule_version', 3)->sole();
        $this->assertSame(8000, $fired->baseline_rate_milli);
        $this->assertSame(10000, $fired->observed_rate_milli);
    }
}

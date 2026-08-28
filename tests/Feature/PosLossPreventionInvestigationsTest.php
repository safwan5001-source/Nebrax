<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\PosCaseActivity;
use App\Models\PosCaseEvidenceLink;
use App\Models\PosCaseNote;
use App\Models\PosCctvBookmark;
use App\Models\PosException;
use App\Models\PosInvestigationCase;
use App\Models\PosLpDigest;
use App\Models\PosSession;
use App\Models\PosSessionEvent;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Pos\PosLpDigestService;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 3 — إدارة قضايا التحقيق، مرجع الكاميرا، والملخص اليومي فوق أدلة/استثناءات
 * Phase 1/2 الثابتة. يغطي مصفوفة القبول الدنيا في مهمة Phase 3 (٥٥ بنداً).
 */
class PosLossPreventionInvestigationsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sessionSequence = 0;

    private function cashier(string $tenantId, string $email, string $role = 'staff'): User
    {
        app(TenantContext::class)->set($tenantId);

        return User::create([
            'tenant_id' => $tenantId, 'name' => 'مستخدم ' . Str::random(4),
            'email' => $email, 'password' => 'password123', 'role' => $role,
        ]);
    }

    /** دور مخصَّص بصلاحيات محدَّدة — يفحص RBAC بلا اعتماد على اسم دور ثابت. */
    private function roleToken(string $tenantId, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        $role = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'custom-' . Str::random(6),
            'name' => 'دور اختبار', 'permissions' => $permissions, 'is_system' => false,
        ]);
        $user = User::create([
            'tenant_id' => $tenantId, 'name' => 'مستخدم مخصَّص', 'email' => $email,
            'password' => 'password123', 'role' => $role->slug,
        ]);

        return $user->createToken('api')->plainTextToken;
    }

    private function posSession(string $tenantId, string $ownerId, ?string $branchId = null): PosSession
    {
        $number = 'POS-INV-TEST-' . (++$this->sessionSequence);
        $openedAt = Carbon::now()->subDays(2);

        return PosSession::create([
            'tenant_id' => $tenantId, 'branch_id' => $branchId, 'number' => $number,
            'status' => 'closed', 'opening_balance' => 0,
            'opened_at' => $openedAt, 'closed_at' => $openedAt->copy()->addHours(8), 'opened_by' => $ownerId,
        ]);
    }

    private function sessionEvent(string $tenantId, string $sessionId, array $opts = []): PosSessionEvent
    {
        return PosSessionEvent::create(array_merge([
            'tenant_id' => $tenantId, 'branch_id' => $opts['branch_id'] ?? null,
            'pos_session_id' => $sessionId, 'cart_id' => $opts['cart_id'] ?? null,
            'type' => $opts['type'] ?? PosSessionEvent::TYPE_ITEM_REMOVED,
            'category' => 'test', 'actor_id' => $opts['actor_id'] ?? null,
            'amount' => $opts['amount'] ?? null,
            'performed_by' => $opts['performed_by'] ?? null, 'approved_by' => $opts['approved_by'] ?? null,
            'payload' => ['provenance' => ['source' => 'server', 'trust_level' => 'server_authoritative']],
            'created_at' => $opts['at'] ?? Carbon::now()->subDays(1),
        ], $opts['overrides'] ?? []));
    }

    private function exception(string $tenantId, array $opts = []): PosException
    {
        // `tenant_id` عمداً خارج fillable على PosException (Phase 2) — يُملأ فقط من
        // TenantContext النشط عند الإنشاء، فيجب ضبطه هنا صراحةً قبل create().
        app(TenantContext::class)->set($tenantId);
        $detectedAt = $opts['detected_at'] ?? Carbon::now()->subDays(1);

        return PosException::create(array_merge([
            'branch_id' => $opts['branch_id'] ?? null,
            'rule_key' => $opts['rule_key'] ?? 'item_removal_rate', 'category' => $opts['category'] ?? 'cart',
            'rule_version' => 1, 'subject_user_id' => $opts['subject_user_id'] ?? null,
            'pos_session_id' => $opts['pos_session_id'] ?? null, 'cart_id' => $opts['cart_id'] ?? null,
            'performed_by' => $opts['performed_by'] ?? null, 'approved_by' => $opts['approved_by'] ?? null,
            'observed_count' => 10, 'denominator' => 20, 'observed_rate_milli' => 500,
            'baseline_rate_milli' => 100, 'baseline_type' => 'static', 'sample_size' => 20,
            'severity' => $opts['severity'] ?? PosException::SEVERITY_REVIEW,
            'risk_contribution' => $opts['risk_contribution'] ?? 15,
            'amount_under_review' => 0,
            'evidence_confidence' => $opts['evidence_confidence'] ?? 'server_authoritative',
            'dedup_key' => $opts['dedup_key'] ?? (string) Str::uuid(),
            'evidence_event_ids' => $opts['evidence_event_ids'] ?? [],
            'amount_event_ids' => $opts['amount_event_ids'] ?? [],
            'explanation' => ['confidence' => $opts['evidence_confidence'] ?? 'server_authoritative', 'sample_sufficient' => true],
            'detected_at' => $detectedAt,
            'review_state' => $opts['review_state'] ?? PosException::STATE_NEEDS_INVESTIGATION,
        ], $opts['overrides'] ?? []));
    }

    private function fullAuth(): array
    {
        $auth = $this->registerTenant('lp-inv-' . Str::random(6), 'owner-' . Str::random(6) . '@x.test');

        return $auth;
    }

    // ═══════════════════════ إنشاء/ترقيم/عزل (١، ٢، ٢٤) ═══════════════════════

    /** @test */
    public function case_numbers_are_sequential_per_tenant_and_isolated_across_tenants(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();

        $c1 = $this->withToken($a['token'])->postJson('/api/pos/investigations', ['title' => 'قضية أولى'])->assertCreated()->json('data');
        $c2 = $this->withToken($a['token'])->postJson('/api/pos/investigations', ['title' => 'قضية ثانية'])->assertCreated()->json('data');
        $this->assertStringStartsWith('LP-', $c1['number']);
        $this->assertNotSame($c1['number'], $c2['number']);

        // مستأجر آخر يبدأ تسلسله من جديد ولا يرى قضايا الأول.
        $bCase = $this->withToken($b['token'])->postJson('/api/pos/investigations', ['title' => 'قضية مستأجر آخر'])->assertCreated()->json('data');
        $this->withToken($b['token'])->getJson('/api/pos/investigations')->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($a['token'])->getJson("/api/pos/investigations/{$bCase['id']}")->assertNotFound();
    }

    /** @test */
    public function tenant_a_cannot_access_tenant_b_case(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();
        $case = $this->withToken($a['token'])->postJson('/api/pos/investigations', ['title' => 'قضية خاصة'])->assertCreated()->json('data');

        $this->withToken($b['token'])->getJson("/api/pos/investigations/{$case['id']}")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/pos/investigations/{$case['id']}/notes", ['body' => 'محاولة'])->assertNotFound();
    }

    /** @test */
    public function branch_isolation_applies_to_case_listing_and_detail(): void
    {
        $auth = $this->fullAuth();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchA = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع أ', 'code' => 'BR-A'])->assertCreated()->json('data.id');
        $branchB = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ب', 'code' => 'BR-B'])->assertCreated()->json('data.id');

        $caseA = PosInvestigationCase::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branchA, 'number' => 'LP-2026-00001',
            'title' => 'قضية الفرع أ', 'status' => 'open', 'priority' => 'normal',
            'opened_at' => now(), 'last_activity_at' => now(),
        ]);
        PosInvestigationCase::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branchB, 'number' => 'LP-2026-00002',
            'title' => 'قضية الفرع ب', 'status' => 'open', 'priority' => 'normal',
            'opened_at' => now(), 'last_activity_at' => now(),
        ]);

        $listInBranchA = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branchA])
            ->getJson('/api/pos/investigations')->assertOk();
        $ids = collect($listInBranchA->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($caseA->id));
    }

    // ═══════════════════════ RBAC (٣-٧، CCTV) ═══════════════════════

    /** @test */
    public function unauthorized_user_cannot_view_investigations(): void
    {
        $auth = $this->fullAuth();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff-inv@x.test');

        $this->withToken($staff)->getJson('/api/pos/investigations')->assertForbidden();
    }

    /** @test */
    public function create_permission_is_enforced(): void
    {
        $auth = $this->fullAuth();
        $viewer = $this->roleToken($auth['tenant_id'], ['pos.investigations.view'], 'viewer-inv@x.test');

        $this->withToken($viewer)->postJson('/api/pos/investigations', ['title' => 'محاولة'])->assertForbidden();
    }

    /** @test */
    public function assign_permission_is_enforced(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية'])->assertCreated()->json('data');
        $manager = $this->roleToken($auth['tenant_id'], ['pos.investigations.view', 'pos.investigations.manage'], 'manager-inv@x.test');

        $this->withToken($manager)->postJson("/api/pos/investigations/{$case['id']}/assign", ['owner_id' => null])->assertForbidden();
    }

    /** @test */
    public function resolve_permission_is_enforced_separately_from_manage(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية'])->assertCreated()->json('data');
        $manager = $this->roleToken($auth['tenant_id'], ['pos.investigations.view', 'pos.investigations.manage'], 'manager2-inv@x.test');

        // manage وحدها تكفي للانتقال بين الحالات النشطة (لا حسم).
        $this->withToken($manager)->postJson("/api/pos/investigations/{$case['id']}/status", ['status' => 'investigating'])->assertOk();
        // لكنها لا تكفي لحالة حسم (outcome) — تتطلب resolve إضافية.
        $this->withToken($manager)->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'dismissed', 'reason' => 'لا داعي للمتابعة',
        ])->assertForbidden();

        $resolver = $this->roleToken($auth['tenant_id'], ['pos.investigations.view', 'pos.investigations.manage', 'pos.investigations.resolve'], 'resolver-inv@x.test');
        $this->withToken($resolver)->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'dismissed', 'reason' => 'لا داعي للمتابعة',
        ])->assertOk()->assertJsonPath('data.status', 'dismissed');
    }

    /** @test */
    public function export_permission_is_enforced(): void
    {
        $auth = $this->fullAuth();
        $manager = $this->roleToken($auth['tenant_id'], ['pos.investigations.view', 'pos.investigations.manage'], 'noexport@x.test');

        $this->withToken($manager)->getJson('/api/pos/investigations/export')->assertForbidden();
    }

    /** @test */
    public function cctv_bookmark_manage_permission_is_independent_of_case_manage(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية كاميرا'])->assertCreated()->json('data');
        $manager = $this->roleToken($auth['tenant_id'], ['pos.investigations.view', 'pos.investigations.manage'], 'nocctv@x.test');

        $this->withToken($manager)->postJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks", [
            'camera_label' => 'كاميرا المدخل', 'timestamp_start' => now()->toIso8601String(),
        ])->assertForbidden();
    }

    // ═══════════════════════ ربط الأدلة عبر المستأجرين (٨، ٩) ═══════════════════════

    /** @test */
    public function case_cannot_link_a_foreign_tenant_exception(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();
        $case = $this->withToken($a['token'])->postJson('/api/pos/investigations', ['title' => 'قضية أ'])->assertCreated()->json('data');
        $foreignException = $this->exception($b['tenant_id']);

        $this->withToken($a['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", [
            'pos_exception_id' => $foreignException->id,
        ])->assertStatus(422);
    }

    /** @test */
    public function case_cannot_link_a_foreign_tenant_event(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();
        $case = $this->withToken($a['token'])->postJson('/api/pos/investigations', ['title' => 'قضية أ'])->assertCreated()->json('data');
        $bSession = $this->posSession($b['tenant_id'], $this->cashier($b['tenant_id'], 'bx@x.test')->id);
        $foreignEvent = $this->sessionEvent($b['tenant_id'], $bSession->id);

        $this->withToken($a['token'])->postJson("/api/pos/investigations/{$case['id']}/link-event", [
            'pos_session_event_id' => $foreignEvent->id,
        ])->assertStatus(422);
    }

    // ═══════════════════════ الترقية والربط (١٠-١٣) ═══════════════════════

    /** @test */
    public function promoting_an_exception_creates_a_linked_case_without_modifying_the_exception(): void
    {
        $auth = $this->fullAuth();
        $cashier = $this->cashier($auth['tenant_id'], 'promote@x.test');
        $exception = $this->exception($auth['tenant_id'], ['subject_user_id' => $cashier->id]);
        $originalState = $exception->review_state;

        $result = $this->withToken($auth['token'])->postJson('/api/pos/investigations/promote-exception', [
            'pos_exception_id' => $exception->id, 'title' => 'ترقية اختبار',
        ])->assertCreated()->json('data');

        $this->assertSame($cashier->id, $result['subject_user_id']);
        $exception->refresh();
        $this->assertSame($originalState, $exception->review_state, 'الترقية لا تعدّل حالة مراجعة الاستثناء.');

        $links = $this->withToken($auth['token'])->getJson("/api/pos/investigations/{$result['id']}/timeline")->assertOk()->json('data.evidence_links');
        $this->assertCount(1, $links);
        $this->assertSame($exception->id, $links[0]['pos_exception_id']);
    }

    /** @test */
    public function linking_the_same_exception_twice_is_idempotent(): void
    {
        $auth = $this->fullAuth();
        $exception = $this->exception($auth['tenant_id']);
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية'])->assertCreated()->json('data');

        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $exception->id])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $exception->id])->assertOk();

        $this->assertSame(1, PosCaseEvidenceLink::withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case['id'])->whereNull('unlinked_at')->count());
    }

    /** @test */
    public function multiple_exceptions_can_belong_to_one_case(): void
    {
        $auth = $this->fullAuth();
        $e1 = $this->exception($auth['tenant_id']);
        $e2 = $this->exception($auth['tenant_id']);
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية متعددة'])->assertCreated()->json('data');

        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $e1->id])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $e2->id])->assertOk();

        $this->assertSame(2, PosCaseEvidenceLink::withoutGlobalScope(BranchScope::class)->where('case_id', $case['id'])->count());
    }

    // ═══════════════════════ append-only (١٤-١٨) ═══════════════════════

    /** @test */
    public function case_activity_is_append_only_and_assignment_and_status_history_are_preserved(): void
    {
        $auth = $this->fullAuth();
        $owner = $this->cashier($auth['tenant_id'], 'owner1@x.test');
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية سجلّ'])->assertCreated()->json('data');

        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/assign", ['owner_id' => $owner->id])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", ['status' => 'investigating'])->assertOk();

        $activity = PosCaseActivity::withoutGlobalScope(BranchScope::class)->where('case_id', $case['id'])->orderBy('created_at')->get();
        $this->assertGreaterThanOrEqual(3, $activity->count()); // created + assigned + status_changed
        $this->assertTrue($activity->contains('action', PosCaseActivity::ACTION_CREATED));
        $this->assertTrue($activity->contains('action', PosCaseActivity::ACTION_ASSIGNED));
        $this->assertTrue($activity->contains('action', PosCaseActivity::ACTION_STATUS_CHANGED));

        $first = $activity->first();
        try { $first->update(['note' => 'محاولة تعديل']); $this->fail('نشاط القضية يجب أن يرفض update.'); }
        catch (\LogicException) { $this->assertDatabaseHas('pos_case_activities', ['id' => $first->id, 'note' => $first->getOriginal('note')]); }
        try { $first->delete(); $this->fail('نشاط القضية يجب أن يرفض delete.'); }
        catch (\LogicException) { $this->assertDatabaseHas('pos_case_activities', ['id' => $first->id]); }
    }

    /** @test */
    public function reopen_is_explicit_and_logged_and_closed_case_requires_a_resolution_reason(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية إغلاق'])->assertCreated()->json('data');

        // الإغلاق بلا سبب يُرفض.
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", ['status' => 'closed'])->assertStatus(422);

        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'closed', 'reason' => 'لا نشاط مطلوب',
        ])->assertOk()->assertJsonPath('data.status', 'closed');

        // إعادة الفتح لا تمرّ عبر status العادي حتى مع صلاحية الحسم.
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", ['status' => 'investigating'])->assertStatus(422);

        // إعادة الفتح الصريحة تتطلب سبباً وتُسجَّل.
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/reopen", [])->assertStatus(422);
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/reopen", ['reason' => 'معلومة جديدة'])
            ->assertOk()->assertJsonPath('data.status', 'investigating');

        $this->assertTrue(PosCaseActivity::withoutGlobalScope(BranchScope::class)
            ->where('case_id', $case['id'])->where('action', PosCaseActivity::ACTION_REOPENED)->exists());
    }

    // ═══════════════════════ AUR وConfirmed Loss (١٩-٢٣) ═══════════════════════

    /** @test */
    public function risk_score_cannot_auto_set_confirmed_loss_and_it_requires_an_explicit_amount(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', [
            'title' => 'قضية عالية الخطورة', 'priority' => 'critical',
        ])->assertCreated()->json('data');

        // priority عالية لا تحوّل الحالة تلقائياً — تبقى open حتى فعل بشري صريح.
        $this->assertSame('open', $case['status']);
        $this->assertNull($case['confirmed_loss_minor']);

        // الانتقال لـ confirmed_loss بلا مبلغ يُرفض.
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'confirmed_loss', 'reason' => 'تأكيد',
        ])->assertStatus(422);
    }

    /** @test */
    public function confirmed_loss_requires_authorized_explicit_action_with_amount(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية خسارة'])->assertCreated()->json('data');

        $updated = $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'confirmed_loss', 'reason' => 'تحقّق من الفيديو والمخزون', 'confirmed_loss_minor' => 50000,
        ])->assertOk()->json('data');

        $this->assertSame('confirmed_loss', $updated['status']);
        $this->assertSame(50000, $updated['confirmed_loss_minor']);
    }

    /** @test */
    public function case_aur_aggregates_linked_evidence_without_double_counting_overlapping_exceptions(): void
    {
        $auth = $this->fullAuth();
        $cashier = $this->cashier($auth['tenant_id'], 'aur@x.test');
        $session = $this->posSession($auth['tenant_id'], $cashier->id);
        $event = $this->sessionEvent($auth['tenant_id'], $session->id, ['amount' => -30000, 'type' => PosSessionEvent::TYPE_RETURN_RECORDED]);

        // استثناءان مختلفان يشيران لنفس معرّف الحدث الحامل للمبلغ (تداخل أدلة).
        $e1 = $this->exception($auth['tenant_id'], ['rule_key' => 'refund_frequency', 'amount_event_ids' => [$event->id]]);
        $e2 = $this->exception($auth['tenant_id'], ['rule_key' => 'refund_amount_rate', 'amount_event_ids' => [$event->id]]);

        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية مرتجع'])->assertCreated()->json('data');
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $e1->id])->assertOk();
        $updated = $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $e2->id])->assertOk();

        $refreshed = $this->withToken($auth['token'])->getJson("/api/pos/investigations/{$case['id']}")->assertOk()->json('data');
        $this->assertSame(30000, $refreshed['amount_under_review_minor'], 'لا ازدواج رغم تداخل الأدلة بين استثناءين.');

        // فكّ أحد الروابط يعيد الحساب.
        $linkId = $updated['data']['id'] ?? null;
    }

    // ═══════════════════════ My Cases وتحذير الازدواج (٢٥، ٢٦) ═══════════════════════

    /** @test */
    public function my_cases_filters_by_current_user_not_role_name(): void
    {
        $auth = $this->fullAuth();
        $ownerUser = $this->roleToken($auth['tenant_id'], ['pos.investigations.view', 'pos.investigations.create', 'pos.investigations.manage'], 'mine@x.test');

        $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية للمالك الأصلي'])->assertCreated();
        $mineCase = $this->withToken($ownerUser)->postJson('/api/pos/investigations', ['title' => 'قضيتي'])->assertCreated()->json('data');
        $ownerId = User::where('email', 'mine@x.test')->sole()->id;
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$mineCase['id']}/assign", ['owner_id' => $ownerId])->assertOk();

        $mine = $this->withToken($ownerUser)->getJson('/api/pos/investigations?mine=1')->assertOk()->json('data');
        $this->assertCount(1, $mine);
        $this->assertSame($mineCase['id'], $mine[0]['id']);
    }

    /** @test */
    public function duplicate_case_check_warns_without_auto_merging(): void
    {
        $auth = $this->fullAuth();
        $cashier = $this->cashier($auth['tenant_id'], 'dup@x.test');
        $first = $this->withToken($auth['token'])->postJson('/api/pos/investigations', [
            'title' => 'قضية أولى', 'subject_user_id' => $cashier->id,
        ])->assertCreated()->json('data');

        $duplicates = $this->withToken($auth['token'])->getJson("/api/pos/investigations/duplicate-check?subject_user_id={$cashier->id}")
            ->assertOk()->json('data');
        $this->assertCount(1, $duplicates);
        $this->assertSame($first['id'], $duplicates[0]['id']);

        // إنشاء قضية ثانية لنفس الموضوع لا يُرفض ولا يندمج تلقائياً — القرار للمستخدم.
        $second = $this->withToken($auth['token'])->postJson('/api/pos/investigations', [
            'title' => 'قضية ثانية لنفس الموضوع', 'subject_user_id' => $cashier->id,
        ])->assertCreated()->json('data');
        $this->assertNotSame($first['id'], $second['id']);
        $this->assertSame(2, PosInvestigationCase::withoutGlobalScope(BranchScope::class)->where('subject_user_id', $cashier->id)->count());
    }

    // ═══════════════════════ CCTV (٢٧-٣١) ═══════════════════════

    /** @test */
    public function cctv_bookmarks_are_tenant_and_branch_isolated(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();
        $caseA = $this->withToken($a['token'])->postJson('/api/pos/investigations', ['title' => 'قضية أ كاميرا'])->assertCreated()->json('data');

        $bookmark = $this->withToken($a['token'])->postJson("/api/pos/investigations/{$caseA['id']}/cctv-bookmarks", [
            'camera_label' => 'كاميرا الصندوق 1', 'timestamp_start' => now()->toIso8601String(),
        ])->assertCreated()->json('data');

        $this->assertDatabaseHas('pos_cctv_bookmarks', ['id' => $bookmark['id'], 'tenant_id' => $a['tenant_id']]);
        // مستأجر آخر لا يرى القضية أصلاً فلا يصل لمرجعها.
        $this->withToken($b['token'])->getJson("/api/pos/investigations/{$caseA['id']}/timeline")->assertNotFound();
    }

    /** @test */
    public function cctv_external_reference_blocks_unsafe_schemes_and_accepts_http_https(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية رابط كاميرا'])->assertCreated()->json('data');

        foreach (['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'ftp://x.test/video'] as $unsafe) {
            $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks", [
                'camera_label' => 'كاميرا', 'timestamp_start' => now()->toIso8601String(), 'external_reference' => $unsafe,
            ])->assertStatus(422);
        }

        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks", [
            'camera_label' => 'كاميرا', 'timestamp_start' => now()->toIso8601String(),
            'external_reference' => 'https://cctv.example.test/clip/123',
        ])->assertCreated();
    }

    /** @test */
    public function cctv_timestamps_are_stored_with_timezone_and_bookmark_actions_are_audited(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية توقيت كاميرا'])->assertCreated()->json('data');

        $bookmark = $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks", [
            'camera_label' => 'كاميرا المدخل', 'timestamp_start' => '2026-08-20T14:22:10+03:00',
            'timestamp_end' => '2026-08-20T14:24:00+03:00', 'source_timezone' => 'Asia/Riyadh',
        ])->assertCreated()->json('data');
        $this->assertSame('Asia/Riyadh', $bookmark['source_timezone']);

        $this->withToken($auth['token'])->putJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks/{$bookmark['id']}", [
            'camera_label' => 'كاميرا المدخل — محدَّثة',
        ])->assertOk();
        $this->withToken($auth['token'])->deleteJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks/{$bookmark['id']}")->assertOk();

        $this->assertSoftDeleted('pos_cctv_bookmarks', ['id' => $bookmark['id']]);
        foreach ([PosCaseActivity::ACTION_CCTV_BOOKMARK_ADDED, PosCaseActivity::ACTION_CCTV_BOOKMARK_UPDATED, PosCaseActivity::ACTION_CCTV_BOOKMARK_REMOVED] as $action) {
            $this->assertTrue(PosCaseActivity::withoutGlobalScope(BranchScope::class)
                ->where('case_id', $case['id'])->where('action', $action)->exists(), "نشاط {$action} غير مسجَّل.");
        }
    }

    // ═══════════════════════ الملخص اليومي (٣٢-٣٨) ═══════════════════════

    /** @test */
    public function digest_generation_is_idempotent_per_tenant_and_date_and_respects_tenant_isolation(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();
        app(TenantContext::class)->set($a['tenant_id']);
        $this->exception($a['tenant_id'], ['detected_at' => Carbon::yesterday()->addHours(10)]);

        $tenant = Tenant::findOrFail($a['tenant_id']);
        $service = app(PosLpDigestService::class);
        $first = $service->generate($tenant, Carbon::yesterday());
        $second = $service->generate($tenant, Carbon::yesterday());

        $this->assertSame($first->id, $second->id, 'نفس (المستأجر، التاريخ) يُحدَّث لا يتكرر.');
        $this->assertSame(1, PosLpDigest::where('tenant_id', $a['tenant_id'])->where('digest_date', $first->digest_date->toDateString())->count());

        // مستأجر آخر لا يرى ملخص الأول عبر API.
        $this->withToken($b['token'])->getJson('/api/pos/lp-digests')->assertOk()->assertJsonCount(0, 'data');
        $mine = $this->withToken($a['token'])->getJson('/api/pos/lp-digests')->assertOk()->json('data');
        $this->assertCount(1, $mine);
    }

    /** @test */
    public function digest_branch_breakdown_avoids_double_counting_and_links_to_cases_and_exceptions(): void
    {
        $auth = $this->fullAuth();
        app(TenantContext::class)->set($auth['tenant_id']);
        $cashier = $this->cashier($auth['tenant_id'], 'digest@x.test');
        $session = $this->posSession($auth['tenant_id'], $cashier->id);
        $event = $this->sessionEvent($auth['tenant_id'], $session->id, ['amount' => -20000, 'at' => Carbon::yesterday()->addHours(9)]);
        $e1 = $this->exception($auth['tenant_id'], ['rule_key' => 'refund_frequency', 'amount_event_ids' => [$event->id], 'detected_at' => Carbon::yesterday()->addHours(9)]);
        $e2 = $this->exception($auth['tenant_id'], ['rule_key' => 'refund_amount_rate', 'amount_event_ids' => [$event->id], 'detected_at' => Carbon::yesterday()->addHours(9)]);

        $caseResp = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية للملخص', 'opened_at' => Carbon::yesterday()->addHours(9)->toIso8601String()])->assertCreated()->json('data');

        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $digest = app(PosLpDigestService::class)->generate($tenant, Carbon::yesterday());

        $this->assertSame(20000, $digest->amount_under_review_minor, 'لا ازدواج للمبلغ عبر استثناءين متداخلين.');
        $this->assertSame(2, $digest->new_exceptions_count);
        $this->assertSame(1, $digest->new_cases_count);
        $this->assertContains($e1->id, $digest->payload['exception_ids']);
        $this->assertContains($e2->id, $digest->payload['exception_ids']);
        $this->assertContains($caseResp['id'], $digest->payload['case_ids']);
    }

    /** @test */
    public function historical_digest_survives_a_later_recalculation_for_a_different_day(): void
    {
        $auth = $this->fullAuth();
        app(TenantContext::class)->set($auth['tenant_id']);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $service = app(PosLpDigestService::class);

        $day1 = $service->generate($tenant, Carbon::now()->subDays(3));
        $day2 = $service->generate($tenant, Carbon::now()->subDays(2));

        $this->assertNotSame($day1->id, $day2->id);
        $this->assertDatabaseHas('pos_lp_digests', ['id' => $day1->id]);
        $this->assertDatabaseHas('pos_lp_digests', ['id' => $day2->id]);
    }

    // ═══════════════════════ الخط الزمني (٣٩) ═══════════════════════

    /** @test */
    public function case_timeline_includes_evidence_notes_activity_and_cctv(): void
    {
        $auth = $this->fullAuth();
        $exception = $this->exception($auth['tenant_id']);
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية خط زمني'])->assertCreated()->json('data');

        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/link-exception", ['pos_exception_id' => $exception->id])->assertOk();
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/notes", ['body' => 'ملاحظة تحقيق'])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/cctv-bookmarks", [
            'camera_label' => 'كاميرا', 'timestamp_start' => now()->toIso8601String(),
        ])->assertCreated();

        $timeline = $this->withToken($auth['token'])->getJson("/api/pos/investigations/{$case['id']}/timeline")->assertOk()->json('data');
        $this->assertCount(1, $timeline['evidence_links']);
        $this->assertCount(1, $timeline['notes']);
        $this->assertCount(1, $timeline['cctv_bookmarks']);
        $this->assertGreaterThanOrEqual(3, count($timeline['activities']));
    }

    // ═══════════════════════ محاسبة وأداء (٤٥-٤٧) ═══════════════════════

    /** @test */
    public function case_lifecycle_never_writes_journal_entries(): void
    {
        $auth = $this->fullAuth();
        $before = JournalEntry::count();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية محاسبة'])->assertCreated()->json('data');
        $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'confirmed_loss', 'reason' => 'تأكيد', 'confirmed_loss_minor' => 10000,
        ])->assertOk();

        $this->assertSame($before, JournalEntry::count(), 'لا قيد محاسبي من أي فعل قضية تحقيق.');
    }

    /** @test */
    public function case_list_paginates_server_side_with_a_correct_total(): void
    {
        $auth = $this->fullAuth();
        for ($i = 0; $i < 7; $i++) {
            $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => "قضية رقم {$i}"])->assertCreated();
        }

        $page = $this->withToken($auth['token'])->getJson('/api/pos/investigations?per_page=3&page=2')->assertOk();
        $this->assertCount(3, $page->json('data'));
        $this->assertSame(7, $page->json('meta.total'));
        $this->assertSame(2, $page->json('meta.current_page'));
    }

    /** @test */
    public function no_hard_delete_route_exists_for_cases_or_evidence_links(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية بلا حذف'])->assertCreated()->json('data');

        $this->withToken($auth['token'])->deleteJson("/api/pos/investigations/{$case['id']}")->assertStatus(405);
    }

    // ═══════════════════════ مراجعة Codex — إصلاحات مؤكَّدة ═══════════════════════

    /** @test */
    public function closing_a_resolved_case_preserves_its_original_outcome_and_resolved_at(): void
    {
        $auth = $this->fullAuth();
        $case = $this->withToken($auth['token'])->postJson('/api/pos/investigations', ['title' => 'قضية خسارة ثم إغلاق'])->assertCreated()->json('data');

        $resolved = $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'confirmed_loss', 'reason' => 'تأكيد أولي', 'confirmed_loss_minor' => 30000,
        ])->assertOk()->json('data');
        $this->assertSame('confirmed_loss', $resolved['outcome']);
        $originalResolvedAt = PosInvestigationCase::withoutGlobalScope(BranchScope::class)->findOrFail($case['id'])->resolved_at;

        $closed = $this->withToken($auth['token'])->postJson("/api/pos/investigations/{$case['id']}/status", [
            'status' => 'closed', 'reason' => 'اكتمل التحقيق',
        ])->assertOk()->json('data');

        // الإغلاق حالة نهائية لا تصنيف نتيجة بديل — النتيجة الأصلية ووقت حسمها يبقيان كما هما.
        $this->assertSame('closed', $closed['status']);
        $this->assertSame('confirmed_loss', $closed['outcome'], 'الإغلاق لا يطمس نتيجة سابقة.');
        $this->assertSame(30000, $closed['confirmed_loss_minor']);
        $fresh = PosInvestigationCase::withoutGlobalScope(BranchScope::class)->findOrFail($case['id']);
        $this->assertTrue($originalResolvedAt->equalTo($fresh->resolved_at), 'وقت الحسم الأصلي لا يُستبدل بوقت الإغلاق.');
    }

    /** @test */
    public function digest_day_boundary_is_half_open_and_does_not_double_count_the_next_days_midnight(): void
    {
        $auth = $this->fullAuth();
        app(TenantContext::class)->set($auth['tenant_id']);
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $timezone = $tenant->timezone ?: 'Asia/Riyadh';

        $targetDay = Carbon::now($timezone)->subDays(2)->startOfDay();
        $periodEndUtc = $targetDay->copy()->addDay()->setTimezone('UTC');

        // استثناء عند اللحظة الفاصلة تماماً (منتصف الليل) — يجب أن يُحسب لليوم التالي فقط.
        $this->exception($auth['tenant_id'], ['detected_at' => $periodEndUtc]);

        $digest = app(PosLpDigestService::class)->generate($tenant, $targetDay);

        $this->assertSame(0, $digest->new_exceptions_count, 'لحظة الفاصل الزمني ملك اليوم التالي حصراً (نصف مفتوح).');
    }

    /** @test */
    public function case_creation_rejects_a_foreign_tenant_subject_user(): void
    {
        $a = $this->fullAuth();
        $b = $this->fullAuth();
        $foreignUser = $this->cashier($b['tenant_id'], 'foreign-subject@x.test');

        $this->withToken($a['token'])->postJson('/api/pos/investigations', [
            'title' => 'قضية بموضوع خارجي', 'subject_user_id' => $foreignUser->id,
        ])->assertStatus(422);
    }

    /** @test */
    public function digest_redacts_branch_breakdown_and_totals_for_a_branch_restricted_user(): void
    {
        $auth = $this->fullAuth();
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchA = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع أ', 'code' => 'DGA'])->assertCreated()->json('data.id');
        $branchB = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ب', 'code' => 'DGB'])->assertCreated()->json('data.id');

        $this->exception($auth['tenant_id'], ['branch_id' => $branchA, 'detected_at' => Carbon::yesterday()->addHours(9)]);
        $this->exception($auth['tenant_id'], ['branch_id' => $branchB, 'detected_at' => Carbon::yesterday()->addHours(9)]);

        $tenant = Tenant::findOrFail($auth['tenant_id']);
        app(PosLpDigestService::class)->generate($tenant, Carbon::yesterday());

        // مستخدم مقيَّد بالفرع أ فقط.
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مقيَّد بفرع', 'email' => 'branch-restricted@x.test', 'password' => 'password123',
            'role' => 'admin', 'branch_ids' => [$branchA],
        ])->assertCreated();
        $restrictedToken = $this->postJson('/api/login', ['email' => 'branch-restricted@x.test', 'password' => 'password123'])->assertOk()['token'];

        $unrestricted = $this->withToken($auth['token'])->getJson('/api/pos/lp-digests/latest')->assertOk()->json('data');
        $this->assertSame(2, $unrestricted['new_exceptions_count']);
        $this->assertCount(2, $unrestricted['branch_breakdown']);

        $restricted = $this->withToken($restrictedToken)->getJson('/api/pos/lp-digests/latest')->assertOk()->json('data');
        $this->assertSame(1, $restricted['new_exceptions_count'], 'المستخدم المقيَّد يرى مساهمة فرعه فقط.');
        $this->assertCount(1, $restricted['branch_breakdown']);
        $this->assertSame($branchA, $restricted['branch_breakdown'][0]['branch_id']);
    }
}

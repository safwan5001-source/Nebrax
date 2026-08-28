<?php

namespace Tests\Feature;

use App\Models\PosException;
use App\Models\PosExceptionRule;
use App\Models\PosOverrideApproval;
use App\Models\PosSessionEvent;
use App\Models\User;
use App\Services\Pos\CashDrawerService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Production Hardening v1 — انحدار مركّز على ثغرات التدقيق النهائية:
 * استهلاك اعتماد الدرج داخل معاملة، عزل فرع عند ربط الدليل، طابور Needs Attention
 * على الإصدار الحالي فقط، وتعيين مالك عبر المستأجرين.
 *
 * لا يولّد قيوداً محاسبية.
 */
class PosLossPreventionHardeningTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    /** @return array{id:string,warehouse_id:string} */
    private function device(array $auth): array
    {
        $n = ++$this->deviceSequence;
        $warehouse = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن صلابة {$n}", 'code' => "HD-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data'];
        $device = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير صلابة {$n}", 'code' => "HD-POS-{$n}",
            'warehouse_id' => $warehouse['id'], 'is_active' => true,
        ])->assertCreated()['data'];

        return ['id' => $device['id'], 'warehouse_id' => $warehouse['id']];
    }

    private function policies(array $auth, array $overrides = []): void
    {
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', ['data' => ['audit_operation_policies' => array_merge([
            'item_remove' => 'allowed', 'price_override' => 'allowed', 'discount_change' => 'allowed',
            'cart_cancel' => 'allowed', 'cash_recount' => 'approval_required',
            'refund' => 'allowed', 'cash_out' => 'allowed', 'manual_drawer_open' => 'allowed',
        ], $overrides)]])->assertOk();
    }

    private function exception(string $tenantId, array $opts = []): PosException
    {
        app(TenantContext::class)->set($tenantId);

        return PosException::create([
            'branch_id' => $opts['branch_id'] ?? null,
            'rule_key' => $opts['rule_key'] ?? 'cross_cashier_refund',
            'category' => $opts['category'] ?? 'returns',
            'rule_version' => $opts['rule_version'] ?? 1,
            'rule_snapshot' => ['weight' => 18],
            'subject_user_id' => $opts['subject_user_id'] ?? null,
            'performed_by' => $opts['performed_by'] ?? ($opts['subject_user_id'] ?? null),
            'window_start' => now()->subDays(7),
            'window_end' => now(),
            'observed_count' => 1,
            'denominator' => 1,
            'observed_rate_milli' => 1000,
            'baseline_rate_milli' => 100,
            'baseline_type' => 'static',
            'sample_size' => 1,
            'severity' => $opts['severity'] ?? PosException::SEVERITY_PRIORITY,
            'risk_contribution' => 18,
            'amount_under_review' => 11500,
            'evidence_confidence' => 'server_authoritative',
            'amount_event_ids' => [],
            'explanation' => ['per' => 'return'],
            'dedup_key' => $opts['dedup_key'] ?? ('hd:' . Str::uuid()),
            'detected_at' => $opts['detected_at'] ?? now()->subHour(),
            'review_state' => $opts['review_state'] ?? PosException::STATE_NEW,
        ]);
    }

    /** @test */
    public function manual_drawer_approval_cannot_be_consumed_twice(): void
    {
        $owner = $this->registerTenant('hd-drawer', 'hd-drawer@example.test');
        app(TenantContext::class)->set($owner['tenant_id']);
        $this->policies($owner, ['manual_drawer_open' => 'approval_required']);
        $approverToken = $this->tokenForRole($owner['tenant_id'], 'admin', 'hd-drawer-approver@example.test');
        $device = $this->device($owner);
        $sessionId = $this->withToken($owner['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 10000, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');

        $approval = $this->withToken($owner['token'])->postJson('/api/pos/approval-requests', [
            'pos_session_id' => $sessionId, 'operation' => 'manual_drawer_open',
            'reason_code' => 'other', 'reason_note' => 'فتح درج معتمد',
        ])->assertCreated()->json('data');
        $this->withToken($approverToken)->postJson("/api/pos/audit/approvals/{$approval['id']}/approve")->assertOk();

        $session = \App\Models\PosSession::findOrFail($sessionId);
        $actor = User::query()->where('tenant_id', $owner['tenant_id'])->where('role', 'owner')->firstOrFail();
        $drawer = app(CashDrawerService::class);

        $drawer->openManually($session, $actor, 'فتح أول', $approval['id']);
        $this->assertSame(PosOverrideApproval::STATUS_CONSUMED, PosOverrideApproval::findOrFail($approval['id'])->status);
        $this->assertSame(1, PosSessionEvent::where('pos_session_id', $sessionId)
            ->where('type', PosSessionEvent::TYPE_OVERRIDE_CONSUMED)->count());

        try {
            $drawer->openManually($session, $actor, 'فتح مكرر', $approval['id']);
            $this->fail('إعادة استهلاك الاعتماد كان يجب أن تفشل.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('الاعتماد', $e->getMessage());
        }

        $this->assertSame(1, PosSessionEvent::where('pos_session_id', $sessionId)
            ->where('type', PosSessionEvent::TYPE_OVERRIDE_CONSUMED)->count());
    }

    /** @test */
    public function branch_restricted_investigator_cannot_link_or_promote_foreign_branch_evidence(): void
    {
        $auth = $this->registerTenant('hd-branch', 'hd-branch@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchA = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع أ صلابة', 'code' => 'HDA'])->assertCreated()->json('data.id');
        $branchB = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع ب صلابة', 'code' => 'HDB'])->assertCreated()->json('data.id');

        $subject = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'موضوع', 'email' => 'hd-subject@example.test',
            'password' => 'password123', 'role' => 'staff',
        ]);
        $exceptionB = $this->exception($auth['tenant_id'], [
            'branch_id' => $branchB, 'subject_user_id' => $subject->id, 'severity' => PosException::SEVERITY_PRIORITY,
        ]);

        // مستخدم مقيَّد بالفرع أ فقط (نفس نمط اختبار الملخص اليومي، مع attach صريح).
        $restricted = User::create([
            'tenant_id' => $auth['tenant_id'],
            'name' => 'محقق مقيّد',
            'email' => 'hd-restricted@example.test',
            'password' => 'password123',
            'role' => 'admin',
        ]);
        $restricted->branches()->sync([$branchA]);
        $restrictedToken = $restricted->createToken('api')->plainTextToken;

        $case = $this->withToken($restrictedToken)->withHeaders(['X-Branch-Id' => $branchA])
            ->postJson('/api/pos/investigations', ['title' => 'قضية الفرع أ'])
            ->assertCreated()->json('data');

        $this->withToken($restrictedToken)->withHeaders(['X-Branch-Id' => $branchA])
            ->postJson("/api/pos/investigations/{$case['id']}/link-exception", [
                'pos_exception_id' => $exceptionB->id,
            ])->assertStatus(422);

        $this->withToken($restrictedToken)->withHeaders(['X-Branch-Id' => $branchA])
            ->postJson('/api/pos/investigations/promote-exception', [
                'pos_exception_id' => $exceptionB->id,
            ])->assertStatus(422);

        // غير المقيّد ما زال يستطيع الترقية عبر الفروع داخل المستأجر.
        $this->withToken($auth['token'])->postJson('/api/pos/investigations/promote-exception', [
            'pos_exception_id' => $exceptionB->id,
        ])->assertCreated();
    }

    /** @test */
    public function needs_attention_hides_exceptions_from_superseded_rule_versions(): void
    {
        $auth = $this->registerTenant('hd-attn', 'hd-attn@example.test');
        $tenant = $auth['tenant_id'];
        app(TenantContext::class)->set($tenant);
        $subject = User::create([
            'tenant_id' => $tenant, 'name' => 'موظف', 'email' => 'hd-attn-subj@example.test',
            'password' => 'password123', 'role' => 'staff',
        ]);

        app(\App\Services\Pos\PosExceptionDetectionService::class)->syncRules();
        $rule = PosExceptionRule::query()->where('rule_key', 'cross_cashier_refund')->firstOrFail();
        $oldVersion = $rule->version;
        $rule->update(['version' => $oldVersion + 1, 'weight' => max(1, $rule->weight)]);

        $this->exception($tenant, [
            'rule_key' => 'cross_cashier_refund',
            'rule_version' => $oldVersion,
            'subject_user_id' => $subject->id,
            'severity' => PosException::SEVERITY_PRIORITY,
            'review_state' => PosException::STATE_NEW,
            'dedup_key' => 'hd:old:' . $oldVersion,
        ]);
        $fresh = $this->exception($tenant, [
            'rule_key' => 'cross_cashier_refund',
            'rule_version' => $oldVersion + 1,
            'subject_user_id' => $subject->id,
            'severity' => PosException::SEVERITY_PRIORITY,
            'review_state' => PosException::STATE_NEW,
            'dedup_key' => 'hd:new:' . ($oldVersion + 1),
        ]);

        $ids = collect($this->withToken($auth['token'])->getJson('/api/pos/audit/needs-attention')->assertOk()->json('data'))
            ->where('kind', 'priority_exception')
            ->pluck('reference.id');

        $this->assertTrue($ids->contains($fresh->id));
        $this->assertFalse($ids->contains(
            PosException::query()->where('dedup_key', 'hd:old:' . $oldVersion)->value('id')
        ));
    }

    /** @test */
    public function assign_rejects_owner_from_another_tenant(): void
    {
        $a = $this->registerTenant('hd-assign-a', 'hd-assign-a@example.test');
        $b = $this->registerTenant('hd-assign-b', 'hd-assign-b@example.test');
        app(TenantContext::class)->set($b['tenant_id']);
        $foreign = User::query()->where('tenant_id', $b['tenant_id'])->where('role', 'owner')->firstOrFail();

        $case = $this->withToken($a['token'])->postJson('/api/pos/investigations', [
            'title' => 'قضية تعيين',
        ])->assertCreated()->json('data');

        $this->withToken($a['token'])->postJson("/api/pos/investigations/{$case['id']}/assign", [
            'owner_id' => $foreign->id,
        ])->assertStatus(422);
    }

    /** @test */
    public function append_only_session_events_reject_instance_mutation(): void
    {
        $auth = $this->registerTenant('hd-append', 'hd-append@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $device = $this->device($auth);
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0, 'pos_device_id' => $device['id'],
        ])->assertCreated()->json('data.id');
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', ['pos_session_id' => $sessionId])
            ->assertCreated()->json('data.cart_id');
        $eventId = $this->withToken($auth['token'])->postJson("/api/pos/carts/{$cart}/events", [
            'pos_session_id' => $sessionId, 'type' => 'item_removed', 'reason_code' => 'wrong_scan',
            'before' => ['item' => ['quantity' => 1]], 'after' => ['items' => []],
        ])->assertCreated()->json('data.id');

        $event = PosSessionEvent::findOrFail($eventId);
        $this->expectException(\LogicException::class);
        $event->update(['reason_note' => 'تلاعب']);
    }

    /** @test */
    public function performer_timeline_index_exists_after_hardening_migration(): void
    {
        $driver = Schema::getConnection()->getDriverName();
        if ($driver === 'sqlite') {
            $rows = DB::select(
                "SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?",
                ['pos_events_performer_type_timeline_index']
            );
            $this->assertNotEmpty($rows);

            return;
        }

        $rows = DB::select(
            'SELECT indexname FROM pg_indexes WHERE indexname = ?',
            ['pos_events_performer_type_timeline_index']
        );
        $this->assertNotEmpty($rows);
    }
}

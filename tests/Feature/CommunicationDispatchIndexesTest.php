<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-03-A — فهارس الموزّع: جزئية، إضافية بحتة، تُسقَط بأمان مع وجود بيانات، وإعادة تشغيل up() آمنة.
 */
class CommunicationDispatchIndexesTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_10_030000_add_dispatch_indexes_to_communication_messages.php';

    private const INDEXES = ['comm_msg_due_idx', 'comm_msg_expiry_idx', 'comm_msg_lease_idx'];

    private function migration(): object
    {
        return require database_path('migrations/'.self::MIGRATION);
    }

    #[Test]
    public function the_three_approved_partial_indexes_exist_with_the_planned_predicates(): void
    {
        foreach (self::INDEXES as $name) {
            $this->assertTrue($this->commIndexExists($name), "missing {$name}");
        }

        $due = $this->commIndexDefinition('comm_msg_due_idx');
        $this->assertStringContainsString('next_attempt_at', $due);
        $this->assertStringContainsString('queued', $due);
        $this->assertStringContainsString('retry_scheduled', $due);
        $this->assertStringContainsString('payload_encrypted IS NOT NULL', $due, 'OTP (no payload) is excluded from the claim index');

        $expiry = $this->commIndexDefinition('comm_msg_expiry_idx');
        $this->assertStringContainsString('expires_at', $expiry);
        $this->assertStringContainsString('retry_scheduled', $expiry);

        $lease = $this->commIndexDefinition('comm_msg_lease_idx');
        $this->assertStringContainsString('lease_until', $lease);
        $this->assertStringContainsString("'sending'", $lease);

        // لا فهرس فريد جديد: الفرادات الأربع المعتمدة كما هي.
        foreach (self::INDEXES as $name) {
            $this->assertStringNotContainsString('UNIQUE', strtoupper($this->commIndexDefinition($name)));
        }
    }

    #[Test]
    public function the_migration_is_additive_only_and_down_drops_just_its_own_indexes_even_with_data(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);
        $before = DB::table('communication_messages')->count();

        $this->migration()->down();

        foreach (self::INDEXES as $name) {
            $this->assertFalse($this->commIndexExists($name), "{$name} must be gone");
        }
        foreach (['comm_msg_tenant_id_unique', 'comm_msg_idem_unique', 'comm_attempt_no_unique', 'comm_attempt_one_inflight'] as $name) {
            $this->assertTrue($this->commIndexExists($name), "{$name} must survive");
        }
        $this->assertSame($before, DB::table('communication_messages')->count());
        $this->assertSame($id, DB::table('communication_messages')->value('id'));

        $this->migration()->up();
        $this->migration()->up(); // إعادة التشغيل آمنة (IF NOT EXISTS)

        foreach (self::INDEXES as $name) {
            $this->assertTrue($this->commIndexExists($name));
        }
    }

    #[Test]
    public function the_claim_query_can_use_the_due_index_on_postgresql(): void
    {
        if ($this->commDriver() !== 'pgsql') {
            $this->markTestSkipped('خطة التنفيذ تُفحص على PostgreSQL فقط.');
        }

        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);
        DB::statement('ANALYZE communication_messages');
        DB::statement('SET LOCAL enable_seqscan = off'); // جدول صغير: نتحقق أن الفهرس صالح للاستعمال لا أن المخطِّط يفضّله

        $plan = collect(DB::select(
            "EXPLAIN SELECT id FROM communication_messages WHERE status IN ('queued','retry_scheduled') AND payload_encrypted IS NOT NULL AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT 50"
        ))->pluck('QUERY PLAN')->implode("\n");

        $this->assertStringContainsString('comm_msg_due_idx', $plan);
    }
}

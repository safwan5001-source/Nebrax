<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Models\CommunicationMessageAttempt;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — تثبيت الهوية في القاعدة (Triggers) على SQLite وPostgreSQL.
 *
 * أحداث النموذج لا تغطي `DB::table()->update()` ولا `Model::query()->update()`؛ لذلك تُختبر هنا
 * التحديثات الخام مباشرة، وتُختبر معها التحديثات المشروعة التي يجب أن تبقى ممكنة.
 */
class CommunicationIdentityProtectionTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function immutableMessageColumns(): array
    {
        return [
            'id' => ['id', '11111111-1111-4111-8111-111111111111'],
            'tenant_id' => ['tenant_id', '22222222-2222-4222-8222-222222222222'],
            'channel' => ['channel', 'email'],
            'classification' => ['classification', 'service'],
            'template_key' => ['template_key', 'other.template'],
            'source' => ['source', 'other.source'],
            'idempotency_hash' => ['idempotency_hash', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
            'recipient_masked' => ['recipient_masked', '+•••99'],
            'max_attempts' => ['max_attempts', 9],
            'expires_at' => ['expires_at', '2099-01-01 00:00:00'],
            'created_at' => ['created_at', '2099-01-01 00:00:00'],
            'request_fingerprint' => ['request_fingerprint', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'],
            'hash_key_version' => ['hash_key_version', 2],
        ];
    }

    #[Test]
    #[DataProvider('immutableMessageColumns')]
    public function raw_query_builder_updates_cannot_change_a_message_identity_column(string $column, mixed $value): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);
        $before = (array) DB::table('communication_messages')->where('id', $id)->first();

        $e = $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update([$column => $value]));
        $this->assertStringContainsString('communication_messages: identity columns are immutable', $e->getMessage());

        $this->assertEquals($before, (array) DB::table('communication_messages')->where('id', $id)->first());
    }

    #[Test]
    public function the_scoped_model_query_builder_cannot_change_tenant_id_either(): void
    {
        $tenantA = $this->commTenant('a');
        $tenantB = $this->commTenant('b');
        $id = $this->insertCommMessage($tenantA->id);
        app(TenantContext::class)->set($tenantA->id);

        $this->expectException(QueryException::class);
        CommunicationMessage::query()->whereKey($id)->update(['tenant_id' => $tenantB->id]);
    }

    #[Test]
    public function the_model_rejects_identity_changes_before_reaching_the_database(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);
        app(TenantContext::class)->set($tenant->id);

        $message = CommunicationMessage::query()->findOrFail($id);
        $message->template_key = 'changed';

        $this->expectException(LogicException::class);
        $message->save();
    }

    #[Test]
    public function legitimate_status_and_progress_updates_remain_possible(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);
        $lease = (string) Str::uuid();

        // مطالبة: queued → sending
        DB::table('communication_messages')->where('id', $id)->update([
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => $lease, 'lease_until' => now()->addMinutes(2)->toDateTimeString(), 'updated_at' => now()->toDateTimeString(),
        ]);
        // قبول المزوّد: يمسح الحمولة والإيجار في الجملة نفسها
        DB::table('communication_messages')->where('id', $id)->update([
            'status' => 'accepted', 'payload_encrypted' => null, 'lease_token' => null, 'lease_until' => null,
            'accepted_at' => now()->toDateTimeString(), 'receipt_deadline_at' => now()->addDays(3)->toDateTimeString(),
        ]);
        // استقرار بلا تحويل إلى expired
        DB::table('communication_messages')->where('id', $id)->update([
            'settled_at' => now()->toDateTimeString(), 'settled_reason' => 'receipt_window_elapsed',
        ]);
        // إيصال متأخر بعد الاستقرار
        DB::table('communication_messages')->where('id', $id)->update(['status' => 'delivered']);

        $row = DB::table('communication_messages')->where('id', $id)->first();
        $this->assertSame('delivered', $row->status);
        $this->assertSame('receipt_window_elapsed', $row->settled_reason);
        $this->assertNull($row->payload_encrypted);
    }

    #[Test]
    public function rewriting_an_identity_column_with_the_same_value_is_tolerated(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);

        $affected = DB::table('communication_messages')->where('id', $id)->update([
            'tenant_id' => $tenant->id, 'channel' => 'sms', 'attempt_count' => 1,
        ]);

        $this->assertSame(1, $affected);
    }

    #[Test]
    public function the_retry_path_keeps_the_payload_a_retry_needs(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinutes(2)->toDateTimeString()]);

        DB::table('communication_messages')->where('id', $id)->update([
            'status' => 'retry_scheduled', 'lease_token' => null, 'lease_until' => null,
            'next_attempt_at' => now()->addMinutes(5)->toDateTimeString(), 'last_error_code' => 'timeout',
        ]);

        $row = DB::table('communication_messages')->where('id', $id)->first();
        $this->assertSame('retry_scheduled', $row->status);
        $this->assertNotNull($row->payload_encrypted, 'an authorized retry still needs its payload');
    }

    #[Test]
    public function an_attempt_moves_once_from_started_to_a_result_and_is_then_frozen(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $attempt = $this->insertCommAttempt($tenant->id, $message);

        $affected = DB::table('communication_message_attempts')->where('id', $attempt)->update([
            'outcome' => 'accepted', 'provider_message_id' => 'prov-1', 'finished_at' => now()->toDateTimeString(),
        ]);
        $this->assertSame(1, $affected);

        $e = $this->commRejects(fn () => DB::table('communication_message_attempts')->where('id', $attempt)->update(['error_code' => 'late']));
        $this->assertStringContainsString('communication_message_attempts', $e->getMessage());
    }

    #[Test]
    public function a_started_attempt_can_be_abandoned_by_recovery(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $attempt = $this->insertCommAttempt($tenant->id, $message);

        $affected = DB::table('communication_message_attempts')->where('message_id', $message)->where('outcome', 'started')
            ->update(['outcome' => 'abandoned', 'finished_at' => now()->toDateTimeString()]);

        $this->assertSame(1, $affected);
        $this->assertSame('abandoned', DB::table('communication_message_attempts')->where('id', $attempt)->value('outcome'));
    }

    /** @return array<string, array{0: string, 1: mixed}> */
    public static function immutableAttemptColumns(): array
    {
        return [
            'tenant_id' => ['tenant_id', '22222222-2222-4222-8222-222222222222'],
            'message_id' => ['message_id', '33333333-3333-4333-8333-333333333333'],
            'attempt_no' => ['attempt_no', 7],
            'provider_key' => ['provider_key', 'other'],
            'started_at' => ['started_at', '2099-01-01 00:00:00'],
            'id' => ['id', '44444444-4444-4444-8444-444444444444'],
        ];
    }

    #[Test]
    #[DataProvider('immutableAttemptColumns')]
    public function raw_updates_cannot_change_an_attempt_identity_column(string $column, mixed $value): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $attempt = $this->insertCommAttempt($tenant->id, $message);

        $this->expectException(QueryException::class);
        DB::table('communication_message_attempts')->where('id', $attempt)->update([$column => $value]);
    }

    #[Test]
    public function the_attempt_model_guards_identity_and_finalized_attempts(): void
    {
        $tenant = $this->commTenant();
        app(TenantContext::class)->set($tenant->id);
        $message = $this->insertCommMessage($tenant->id);

        $attempt = CommunicationMessageAttempt::create([
            'message_id' => $message, 'attempt_no' => 1, 'provider_key' => 'fake', 'started_at' => now(),
        ]);
        $this->assertSame($tenant->id, $attempt->tenant_id);
        $this->assertSame('started', $attempt->fresh()->outcome);

        $attempt->forceFill(['outcome' => 'accepted', 'finished_at' => now(), 'provider_message_id' => 'p1'])->save();

        $attempt = $attempt->fresh();
        $attempt->error_code = 'late';
        $this->expectException(LogicException::class);
        $attempt->save();
    }

    #[Test]
    public function the_identity_triggers_exist_on_this_engine(): void
    {
        if ($this->commDriver() === 'pgsql') {
            $this->assertSame(['comm_attempt_guard', 'comm_msg_fingerprint_required', 'comm_msg_identity_immutable'], $this->commTriggerNames());
            $this->assertSame(2, DB::table('pg_proc')->whereIn('proname', ['communication_messages_guard_identity', 'communication_message_attempts_guard'])->count());
        } else {
            $this->assertSame(
                [
                    'comm_attempt_guard', 'comm_msg_fingerprint_insert', 'comm_msg_fingerprint_update',
                    'comm_msg_identity_immutable', 'comm_msg_privacy_insert', 'comm_msg_privacy_update',
                ],
                $this->commTriggerNames()
            );
        }
    }
}

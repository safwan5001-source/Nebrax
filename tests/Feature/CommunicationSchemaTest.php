<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Models\CommunicationMessageAttempt;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\DispatchOutcome;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — بنية الجدولين وقيودهما (SQLite وPostgreSQL).
 *
 * يثبت: الأعمدة المعتمدة بالضبط، غياب الأعمدة المؤجَّلة، الفرادات والـFK المركّبة والفهرس الجزئي،
 * التفرّد ضمن المستأجر دون كشف مستأجر آخر، CASCADE، وتطابق القيم مع العقود المدمجة (#1494).
 * قواعد CHECK الشكلية على PostgreSQL في `CommunicationSchemaPostgresTest`.
 */
class CommunicationSchemaTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const MESSAGE_COLUMNS = [
        'id', 'tenant_id', 'channel', 'classification', 'template_key', 'source', 'idempotency_hash',
        'recipient_masked', 'payload_encrypted', 'status', 'attempt_count', 'max_attempts',
        'next_attempt_at', 'expires_at', 'lease_token', 'lease_until', 'last_error_code', 'accepted_at',
        'receipt_deadline_at', 'settled_at', 'settled_reason', 'created_at', 'updated_at',
    ];

    private const ATTEMPT_COLUMNS = [
        'id', 'tenant_id', 'message_id', 'attempt_no', 'provider_key', 'outcome', 'error_code',
        'provider_message_id', 'started_at', 'finished_at',
    ];

    #[Test]
    public function both_tables_have_exactly_the_approved_columns(): void
    {
        $this->assertEqualsCanonicalizing(self::MESSAGE_COLUMNS, Schema::getColumnListing('communication_messages'));
        $this->assertEqualsCanonicalizing(self::ATTEMPT_COLUMNS, Schema::getColumnListing('communication_message_attempts'));
    }

    #[Test]
    public function deferred_hmac_and_receipt_columns_are_absent(): void
    {
        $deferred = [
            'recipient_hash', 'hash_key_version', 'request_fingerprint', 'status_changed_at',
            'provider_key', 'provider_message_id', 'delivered_at', 'read_at',
        ];
        foreach ($deferred as $column) {
            $this->assertFalse(Schema::hasColumn('communication_messages', $column), "{$column} must not exist on messages");
        }
        foreach (['lease_token', 'http_status', 'duration_ms'] as $column) {
            $this->assertFalse(Schema::hasColumn('communication_message_attempts', $column), "{$column} must not exist on attempts");
        }
    }

    #[Test]
    public function column_nullability_and_defaults_match_the_approved_schema(): void
    {
        $messages = collect(Schema::getColumns('communication_messages'))->keyBy('name');
        $required = ['tenant_id', 'channel', 'classification', 'template_key', 'source', 'idempotency_hash',
            'recipient_masked', 'status', 'attempt_count', 'max_attempts', 'expires_at'];
        foreach ($required as $column) {
            $this->assertFalse($messages[$column]['nullable'], "{$column} must be NOT NULL");
        }
        $nullable = ['payload_encrypted', 'next_attempt_at', 'lease_token', 'lease_until', 'last_error_code',
            'accepted_at', 'receipt_deadline_at', 'settled_at', 'settled_reason'];
        foreach ($nullable as $column) {
            $this->assertTrue($messages[$column]['nullable'], "{$column} must be nullable");
        }
        $this->assertStringContainsString('queued', (string) $messages['status']['default']);
        // PostgreSQL يعيد '0'::smallint وSQLite يعيد 0 — يُستخلص الرقم.
        $this->assertSame('0', preg_replace('/[^0-9]/', '', (string) $messages['attempt_count']['default']));

        $attempts = collect(Schema::getColumns('communication_message_attempts'))->keyBy('name');
        foreach (['tenant_id', 'message_id', 'attempt_no', 'provider_key', 'outcome', 'started_at'] as $column) {
            $this->assertFalse($attempts[$column]['nullable'], "{$column} must be NOT NULL");
        }
        foreach (['error_code', 'provider_message_id', 'finished_at'] as $column) {
            $this->assertTrue($attempts[$column]['nullable'], "{$column} must be nullable");
        }
        $this->assertStringContainsString('started', (string) $attempts['outcome']['default']);
    }

    #[Test]
    public function expected_unique_indexes_exist_and_every_unique_index_is_tenant_safe(): void
    {
        foreach (['comm_msg_tenant_id_unique', 'comm_msg_idem_unique', 'comm_attempt_no_unique', 'comm_attempt_one_inflight'] as $name) {
            $this->assertTrue($this->commIndexExists($name), "missing index {$name}");
        }

        // I-8: لا فريد عالمي يكشف مستأجراً آخر — كل فريد يبدأ بـtenant_id أو message_id (المحميّ بالـFK المركّبة).
        foreach (['communication_messages', 'communication_message_attempts'] as $table) {
            foreach (Schema::getIndexes($table) as $index) {
                if (! $index['unique'] || $index['primary']) {
                    continue;
                }
                $this->assertContains($index['columns'][0], ['tenant_id', 'message_id'], "{$index['name']} on {$table} must lead with a tenant-safe column");
            }
        }
    }

    #[Test]
    public function in_flight_index_is_partial_on_started_outcome(): void
    {
        $definition = $this->commIndexDefinition('comm_attempt_one_inflight');
        $this->assertStringContainsString('UNIQUE', strtoupper($definition));
        $this->assertStringContainsString("outcome", $definition);
        $this->assertStringContainsString("'started'", $definition);
    }

    #[Test]
    public function deferred_performance_and_receipt_indexes_are_not_created(): void
    {
        $names = collect(['communication_messages', 'communication_message_attempts'])
            ->flatMap(fn (string $table) => collect(Schema::getIndexes($table))->reject(fn (array $i) => $i['primary'])->pluck('name'))
            ->all();

        $this->assertEqualsCanonicalizing([
            'comm_msg_tenant_id_unique', 'comm_msg_idem_unique', 'comm_attempt_no_unique', 'comm_attempt_one_inflight',
        ], $names);
    }

    #[Test]
    public function attempts_have_a_composite_cascading_foreign_key_to_messages(): void
    {
        $fk = collect(Schema::getForeignKeys('communication_message_attempts'))
            ->first(fn (array $f) => $f['foreign_table'] === 'communication_messages');

        $this->assertNotNull($fk);
        $this->assertSame(['tenant_id', 'message_id'], $fk['columns']);
        $this->assertSame(['tenant_id', 'id'], $fk['foreign_columns']);
        $this->assertSame('cascade', strtolower($fk['on_delete']));

        $tenantFk = collect(Schema::getForeignKeys('communication_messages'))->first(fn (array $f) => $f['foreign_table'] === 'tenants');
        $this->assertNotNull($tenantFk);
        $this->assertSame('cascade', strtolower($tenantFk['on_delete']));
    }

    #[Test]
    public function foreign_keys_are_enforced_by_the_connection(): void
    {
        if ($this->commDriver() === 'sqlite') {
            $this->assertSame(1, (int) DB::selectOne('PRAGMA foreign_keys')->foreign_keys);
        }

        $tenantA = $this->commTenant('a');
        $this->expectException(QueryException::class);
        $this->insertCommAttempt($tenantA->id, '00000000-0000-4000-8000-000000000000');
    }

    #[Test]
    public function composite_foreign_key_rejects_an_attempt_from_another_tenant(): void
    {
        $tenantA = $this->commTenant('a');
        $tenantB = $this->commTenant('b');
        $messageOfA = $this->insertCommMessage($tenantA->id);

        $this->expectException(QueryException::class);
        $this->insertCommAttempt($tenantB->id, $messageOfA);
    }

    #[Test]
    public function the_same_tenant_cannot_duplicate_an_idempotency_hash_but_tenants_are_independent(): void
    {
        $tenantA = $this->commTenant('a');
        $tenantB = $this->commTenant('b');
        $hash = hash('sha256', 'shared-key');

        $this->insertCommMessage($tenantA->id, ['idempotency_hash' => $hash]);
        $this->insertCommMessage($tenantB->id, ['idempotency_hash' => $hash]);
        $this->assertSame(2, DB::table('communication_messages')->where('idempotency_hash', $hash)->count());

        $e = $this->commRejects(fn () => $this->insertCommMessage($tenantA->id, ['idempotency_hash' => $hash]));
        // رسالة التعارض لا تكشف شيئاً عن المستأجر الآخر: تذكر القيد/الأعمدة فقط.
        $this->assertStringNotContainsString($tenantB->id, $e->getMessage());
    }

    #[Test]
    public function attempt_numbers_are_unique_per_message(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $first = $this->insertCommAttempt($tenant->id, $message, ['attempt_no' => 1]);
        DB::table('communication_message_attempts')->where('id', $first)->update([
            'outcome' => 'retryable_failure', 'finished_at' => now()->toDateTimeString(),
        ]);

        $this->expectException(QueryException::class);
        $this->insertCommAttempt($tenant->id, $message, ['attempt_no' => 1]);
    }

    #[Test]
    public function only_one_started_attempt_may_exist_per_message(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $first = $this->insertCommAttempt($tenant->id, $message, ['attempt_no' => 1]);

        $this->commRejects(fn () => $this->insertCommAttempt($tenant->id, $message, ['attempt_no' => 2]));

        // بعد إنهاء الأولى تُقبل التالية.
        DB::table('communication_message_attempts')->where('id', $first)->update([
            'outcome' => 'retryable_failure', 'finished_at' => now()->toDateTimeString(),
        ]);
        $this->insertCommAttempt($tenant->id, $message, ['attempt_no' => 2]);
        $this->assertSame(2, DB::table('communication_message_attempts')->where('message_id', $message)->count());

        // رسالة أخرى مستقلة: محاولتها الجارية لا تتعارض.
        $other = $this->insertCommMessage($tenant->id);
        $this->insertCommAttempt($tenant->id, $other, ['attempt_no' => 1]);
        $this->assertTrue(true);
    }

    #[Test]
    public function deleting_a_message_cascades_to_attempts_and_deleting_a_tenant_to_messages(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $this->insertCommAttempt($tenant->id, $message);

        DB::table('communication_messages')->where('id', $message)->delete();
        $this->assertSame(0, DB::table('communication_message_attempts')->where('message_id', $message)->count());

        $other = $this->insertCommMessage($tenant->id);
        $this->insertCommAttempt($tenant->id, $other);
        DB::table('tenants')->where('id', $tenant->id)->delete();
        $this->assertSame(0, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
        $this->assertSame(0, DB::table('communication_message_attempts')->where('tenant_id', $tenant->id)->count());
    }

    #[Test]
    public function a_valid_row_exists_for_every_delivery_status_through_the_database_alone(): void
    {
        $tenant = $this->commTenant();
        foreach (DeliveryStatus::cases() as $status) {
            $shapes = $this->validShapesByStatus();
            $this->assertArrayHasKey($status->value, $shapes, "no valid shape defined for {$status->value}");
            $id = $this->insertCommMessage($tenant->id, ['status' => $status->value] + $shapes[$status->value]);
            $this->assertSame($status->value, DB::table('communication_messages')->where('id', $id)->value('status'));
        }
    }

    #[Test]
    public function the_model_guard_accepts_every_delivery_status_and_rejects_unknown_values(): void
    {
        $tenant = $this->commTenant();
        app(\App\Tenancy\TenantContext::class)->set($tenant->id);

        foreach (DeliveryStatus::cases() as $status) {
            $row = $this->commMessageRow($tenant->id, ['status' => $status->value] + $this->validShapesByStatus()[$status->value]);
            unset($row['id'], $row['tenant_id'], $row['created_at'], $row['updated_at']);
            if ($row['payload_encrypted'] !== null) {
                $row['payload_encrypted'] = ['address' => '+966500000000', 'variables' => ['k' => 'v']];
            }
            $message = new CommunicationMessage($row);
            $message->save();
            $this->assertSame($status->value, $message->fresh()->status);
        }

        $this->expectException(\LogicException::class);
        (new CommunicationMessage(['channel' => 'sms', 'classification' => 'transactional', 'template_key' => 't', 'source' => 's',
            'idempotency_hash' => hash('sha256', 'x'), 'recipient_masked' => '+•••12', 'max_attempts' => 3,
            'expires_at' => now()->addHour(), 'status' => 'bogus', 'next_attempt_at' => now()]))->save();
    }

    #[Test]
    public function attempt_outcomes_cover_every_dispatch_outcome(): void
    {
        foreach (DispatchOutcome::cases() as $outcome) {
            $this->assertContains($outcome->value, CommunicationMessageAttempt::OUTCOMES);
        }
        $this->assertContains('started', CommunicationMessageAttempt::OUTCOMES);
        $this->assertContains('abandoned', CommunicationMessageAttempt::OUTCOMES);
        $this->assertCount(count(DispatchOutcome::cases()) + 2, CommunicationMessageAttempt::OUTCOMES);
    }

    #[Test]
    public function the_tables_are_empty_after_migration_and_no_runtime_surface_was_added(): void
    {
        $this->assertSame(0, DB::table('communication_messages')->count());
        $this->assertSame(0, DB::table('communication_message_attempts')->count());

        $routes = collect(\Illuminate\Support\Facades\Route::getRoutes()->getRoutes())->map->uri()->implode("\n");
        $this->assertStringNotContainsString('communication', $routes);

        $schedule = collect(app(\Illuminate\Console\Scheduling\Schedule::class)->events())->map->command->implode("\n");
        $this->assertStringNotContainsString('communication', $schedule);
    }
}

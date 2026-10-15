<?php

namespace Tests\Feature;

use App\Support\Communications\CommunicationChannel;
use App\Support\Communications\DeliveryStatus;
use App\Support\Communications\MessageClassification;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — قواعد CHECK الشكلية على PostgreSQL (الإنتاج وCI).
 *
 * SQLite لا يضيف CHECK بعد الإنشاء، فهذه القواعد لا وجود لها هناك (يحرسها `CommunicationMessage`
 * ويغطيها `CommunicationPrivacyTest::the_model_guard_covers_the_shape_rules_sqlite_cannot_check`).
 * تُهمَل هذه الاختبارات على SQLite — الإهمال ليس نجاحاً ويُبلَّغ منفصلاً.
 */
class CommunicationSchemaPostgresTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('قواعد CHECK الشكلية للاتصالات تُفرض على PostgreSQL فقط (SQLite لا يدعمها بعد الإنشاء).');
        }
    }

    /** @return array<string, array{0: array<string, mixed>, 1: string}> صف غير صالح ⇒ اسم القيد الذي يرفضه */
    public static function invalidMessageShapes(): array
    {
        $now = '2026-01-01 00:00:00';
        $terminal = ['payload_encrypted' => null, 'next_attempt_at' => null];

        return [
            'unknown channel' => [['channel' => 'fax'], 'comm_msg_enums_chk'],
            'unknown classification' => [['classification' => 'spam'], 'comm_msg_enums_chk'],
            'unknown status' => [['status' => 'bogus', 'payload_encrypted' => null], 'comm_msg_enums_chk'],
            'bad settled_reason' => [['status' => 'cancelled', 'settled_at' => $now, 'settled_reason' => 'x'] + $terminal, 'comm_msg_enums_chk'],
            'otp with payload' => [['classification' => 'otp', 'max_attempts' => 1], 'comm_msg_otp_privacy_chk'],
            'otp with two attempts' => [['classification' => 'otp', 'payload_encrypted' => null, 'max_attempts' => 2], 'comm_msg_otp_privacy_chk'],
            'otp retry_scheduled' => [['classification' => 'otp', 'payload_encrypted' => null, 'max_attempts' => 1, 'status' => 'retry_scheduled', 'attempt_count' => 1], 'comm_msg_otp_privacy_chk'],
            'payload outside sendable states' => [['status' => 'accepted', 'attempt_count' => 1, 'next_attempt_at' => null, 'accepted_at' => $now, 'receipt_deadline_at' => $now], 'comm_msg_payload_lifecycle_chk'],
            'non-otp queued without payload' => [['payload_encrypted' => null], 'comm_msg_deferred_payload_chk'],
            'attempt_count over max' => [['attempt_count' => 4], 'comm_msg_attempts_chk'],
            'zero max_attempts' => [['max_attempts' => 0], 'comm_msg_attempts_chk'],
            'sending without lease' => [['status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null], 'comm_msg_lease_chk'],
            'queued with a lease' => [['lease_token' => '11111111-1111-4111-8111-111111111111', 'lease_until' => $now], 'comm_msg_lease_chk'],
            'queued without next_attempt_at' => [['next_attempt_at' => null], 'comm_msg_due_chk'],
            'accepted without deadline' => [['status' => 'accepted', 'attempt_count' => 1, 'accepted_at' => $now] + $terminal, 'comm_msg_receipt_chk'],
            'unknown without deadline' => [['status' => 'unknown', 'attempt_count' => 1] + $terminal, 'comm_msg_receipt_chk'],
            'accepted without accepted_at' => [['status' => 'accepted', 'attempt_count' => 1, 'receipt_deadline_at' => $now] + $terminal, 'comm_msg_receipt_chk'],
            'terminal without settled_at' => [['status' => 'cancelled'] + $terminal, 'comm_msg_settled_chk'],
            'settled_at without reason' => [['status' => 'cancelled', 'settled_at' => $now] + $terminal, 'comm_msg_settled_chk'],
            'reason without settled_at' => [['status' => 'cancelled', 'settled_reason' => 'final_status'] + $terminal, 'comm_msg_settled_chk'],
        ];
    }

    /** @param  array<string, mixed>  $override */
    #[Test]
    #[DataProvider('invalidMessageShapes')]
    public function the_database_rejects_each_invalid_message_shape(array $override, string $constraint): void
    {
        $tenant = $this->commTenant();

        $e = $this->commRejects(fn () => $this->insertCommMessage($tenant->id, $override));

        $this->assertStringContainsString($constraint, $e->getMessage());
        $this->assertSame(0, DB::table('communication_messages')->where('tenant_id', $tenant->id)->count());
    }

    #[Test]
    public function the_enum_check_matches_the_merged_contracts_exactly(): void
    {
        $definition = (string) DB::selectOne("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'comm_msg_enums_chk'")->d;

        $start = strpos($definition, '(status)::text = ANY');
        $this->assertNotFalse($start, 'could not locate the status list in: '.$definition);
        $segment = substr($definition, $start, (int) strpos($definition, '::text[]', $start) - $start);
        preg_match_all("/'([a-z_]+)'/", $segment, $values);

        $this->assertEqualsCanonicalizing(array_map(fn ($c) => $c->value, DeliveryStatus::cases()), $values[1]);

        foreach (CommunicationChannel::cases() as $channel) {
            $this->assertStringContainsString("'{$channel->value}'", $definition);
        }
        foreach (MessageClassification::cases() as $classification) {
            $this->assertStringContainsString("'{$classification->value}'", $definition);
        }

        $terminal = collect(DeliveryStatus::cases())->filter(fn ($c) => $c->isTerminal())->map(fn ($c) => $c->value)->all();
        $settled = (string) DB::selectOne("SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint WHERE conname = 'comm_msg_settled_chk'")->d;
        foreach ($terminal as $status) {
            $this->assertStringContainsString("'{$status}'", $settled);
        }
        $this->assertSame(6, count($terminal));
    }

    #[Test]
    public function every_approved_constraint_exists(): void
    {
        $names = DB::table('pg_constraint')->whereIn('conrelid', [
            DB::raw("'communication_messages'::regclass"), DB::raw("'communication_message_attempts'::regclass"),
        ])->pluck('conname')->all();

        foreach ([
            'comm_msg_enums_chk', 'comm_msg_otp_privacy_chk', 'comm_msg_payload_lifecycle_chk', 'comm_msg_deferred_payload_chk',
            'comm_msg_attempts_chk', 'comm_msg_lease_chk', 'comm_msg_due_chk', 'comm_msg_receipt_chk', 'comm_msg_settled_chk',
            'comm_attempt_outcome_chk', 'comm_attempt_message_fk', 'comm_msg_tenant_id_unique', 'comm_msg_idem_unique', 'comm_attempt_no_unique',
        ] as $expected) {
            $this->assertContains($expected, $names);
        }
    }

    /** @return array<string, array{0: array<string, mixed>}> */
    public static function invalidAttemptShapes(): array
    {
        return [
            'unknown outcome' => [['outcome' => 'bogus', 'finished_at' => '2026-01-01 00:00:00']],
            'started with finished_at' => [['outcome' => 'started', 'finished_at' => '2026-01-01 00:00:00']],
            'finished outcome without finished_at' => [['outcome' => 'accepted', 'finished_at' => null]],
            'attempt_no zero' => [['attempt_no' => 0]],
        ];
    }

    /** @param  array<string, mixed>  $override */
    #[Test]
    #[DataProvider('invalidAttemptShapes')]
    public function the_database_rejects_each_invalid_attempt_shape(array $override): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);

        $e = $this->commRejects(fn () => $this->insertCommAttempt($tenant->id, $message, $override));

        $this->assertStringContainsString('comm_attempt_outcome_chk', $e->getMessage());
    }

    #[Test]
    public function trigger_failures_use_a_sqlstate_that_unique_violation_handlers_do_not_swallow(): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);

        $e = $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update(['tenant_id' => (string) Str::uuid()]));

        // CustomerOtpService يعامل 23000/23505 تعارض تفرّد؛ استثناء الـTrigger (P0001) لا يلتبس بهما.
        $this->assertSame('P0001', (string) $e->getCode());
    }
}

<?php

namespace Tests\Feature;

use App\Models\CommunicationMessage;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-B1 — سلوك الترحيل الإضافي: up/down، الصفوف القديمة، وحفظ الفهارس والـTriggers القائمة.
 *
 * الصف «القديم» يُنتَج بتراجع الامتداد أولاً (الجدول فارغ ⇒ آمن) ثم إدراج صف بلا بصمة ثم إعادة تطبيق الامتداد —
 * أي محاكاة حقيقية لصف سبق 02-B1، لا تحايل على الـTriggers. DDL معاملاتي في المحرّكين فيُستعاد بعد كل اختبار.
 */
class CommunicationFingerprintMigrationTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const FINGERPRINT_MIGRATION = '2026_11_10_020000_add_request_fingerprint_to_communication_messages.php';

    private const FP = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

    /** @return array<string, array{0: string}> */
    public static function everyEnvironment(): array
    {
        return ['production' => ['production'], 'staging' => ['staging'], 'local' => ['local'], 'testing' => ['testing']];
    }

    private function migration(): object
    {
        return require database_path('migrations/'.self::FINGERPRINT_MIGRATION);
    }

    /** @return list<string> */
    private function indexNames(): array
    {
        return collect(['communication_messages', 'communication_message_attempts'])
            ->flatMap(fn (string $table) => collect(Schema::getIndexes($table))->pluck('name'))
            ->sort()->values()->all();
    }

    /** @return list<string> */
    private function columns(): array
    {
        return collect(Schema::getColumnListing('communication_messages'))->sort()->values()->all();
    }

    /** @return list<string> */
    private function preB1Triggers(): array
    {
        return $this->commDriver() === 'pgsql'
            ? ['comm_attempt_guard', 'comm_msg_identity_immutable']
            : ['comm_attempt_guard', 'comm_msg_identity_immutable', 'comm_msg_privacy_insert', 'comm_msg_privacy_update'];
    }

    /** @return list<string> */
    private function postB1Triggers(): array
    {
        return $this->commDriver() === 'pgsql'
            ? ['comm_attempt_guard', 'comm_msg_fingerprint_required', 'comm_msg_identity_immutable']
            : ['comm_attempt_guard', 'comm_msg_fingerprint_insert', 'comm_msg_fingerprint_update', 'comm_msg_identity_immutable', 'comm_msg_privacy_insert', 'comm_msg_privacy_update'];
    }

    private function identityTriggerDefinition(): string
    {
        return $this->commDriver() === 'pgsql'
            ? (string) DB::table('pg_proc')->where('proname', 'communication_messages_guard_identity')->value('prosrc')
            : (string) DB::table('sqlite_master')->where('type', 'trigger')->where('name', 'comm_msg_identity_immutable')->value('sql');
    }

    #[Test]
    public function the_extension_adds_exactly_two_columns_and_no_index(): void
    {
        $afterColumns = $this->columns();
        $afterIndexes = $this->indexNames();
        $this->assertSame($this->postB1Triggers(), $this->commTriggerNames());

        $this->migration()->down();

        $this->assertSame(array_values(array_diff($afterColumns, ['request_fingerprint', 'hash_key_version'])), $this->columns());
        $this->assertSame($afterIndexes, $this->indexNames(), 'rollback must leave every 02-A index exactly as it was');
        $this->assertSame($this->preB1Triggers(), $this->commTriggerNames(), 'rollback must restore exactly the 02-A triggers');

        $this->migration()->up();

        $this->assertSame($afterColumns, $this->columns());
        $this->assertSame($afterIndexes, $this->indexNames(), 'the extension must not add or drop any index');
        $this->assertSame($this->postB1Triggers(), $this->commTriggerNames());
        $this->assertContains('comm_attempt_one_inflight', $afterIndexes);
    }

    #[Test]
    public function the_identity_trigger_is_extended_then_restored_to_its_original_definition(): void
    {
        $this->assertStringContainsString('request_fingerprint', $this->identityTriggerDefinition());
        $this->assertStringContainsString('hash_key_version', $this->identityTriggerDefinition());

        $this->migration()->down();

        $restored = $this->identityTriggerDefinition();
        $this->assertStringNotContainsString('request_fingerprint', $restored);
        $this->assertStringNotContainsString('hash_key_version', $restored);
        foreach (['tenant_id', 'idempotency_hash', 'recipient_masked', 'expires_at', 'created_at'] as $original) {
            $this->assertStringContainsString($original, $restored);
        }
    }

    #[Test]
    public function the_original_02a_protections_still_hold_after_up_down_up(): void
    {
        $this->migration()->down();
        $this->migration()->up();

        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);

        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update(['tenant_id' => (string) Str::uuid()]));
        $this->commRejects(fn () => $this->insertCommMessage($tenant->id, ['classification' => 'otp', 'payload_encrypted' => 'x', 'max_attempts' => 1]));
        $attempt = $this->insertCommAttempt($tenant->id, $id);
        $this->commRejects(fn () => $this->insertCommAttempt($tenant->id, $id, ['attempt_no' => 2]));
        $this->assertSame(1, DB::table('communication_message_attempts')->where('id', $attempt)->count());
    }

    #[Test]
    public function legacy_rows_survive_the_extension_stay_updatable_and_keep_null_metadata(): void
    {
        // صف سبق 02-B1: يُدرَج على Schema 02-A الصرفة ثم يُطبَّق الامتداد فوقه.
        $this->migration()->down();
        $tenant = $this->commTenant();
        $row = $this->legacyCommMessageRow($tenant->id);
        DB::table('communication_messages')->insert($row);
        $attempt = $this->insertCommAttempt($tenant->id, $row['id']);

        $this->migration()->up();

        $legacy = DB::table('communication_messages')->where('id', $row['id'])->first();
        $this->assertNull($legacy->request_fingerprint);
        $this->assertNull($legacy->hash_key_version);
        $this->assertSame('queued', $legacy->status);
        $this->assertSame(1, DB::table('communication_message_attempts')->where('id', $attempt)->count());

        // دورة حياة الصف القديم تعمل (لا قيد يشترط بصمة على التحديث).
        $this->assertSame(1, DB::table('communication_messages')->where('id', $row['id'])->update([
            'status' => 'sending', 'attempt_count' => 1, 'next_attempt_at' => null,
            'lease_token' => (string) Str::uuid(), 'lease_until' => now()->addMinutes(2)->toDateTimeString(),
        ]));
        $this->assertSame(1, DB::table('communication_messages')->where('id', $row['id'])->update([
            'status' => 'accepted', 'payload_encrypted' => null, 'lease_token' => null, 'lease_until' => null,
            'accepted_at' => now()->toDateTimeString(), 'receipt_deadline_at' => now()->addDays(3)->toDateTimeString(),
        ]));
        $this->assertSame('accepted', DB::table('communication_messages')->where('id', $row['id'])->value('status'));
    }

    #[Test]
    public function a_legacy_row_can_never_gain_metadata_after_insertion(): void
    {
        $this->migration()->down();
        $tenant = $this->commTenant();
        $row = $this->legacyCommMessageRow($tenant->id);
        DB::table('communication_messages')->insert($row);
        $this->migration()->up();

        // لا Backfill ولا تعبئة لاحقة: NULL → قيمة محظور (ثبات حتى NULL).
        $e = $this->commRejects(fn () => DB::table('communication_messages')->where('id', $row['id'])->update([
            'request_fingerprint' => self::FP, 'hash_key_version' => 1,
        ]));
        $this->assertStringContainsString('identity columns are immutable', $e->getMessage());

        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $row['id'])->update(['request_fingerprint' => self::FP]));
        $this->assertNull(DB::table('communication_messages')->where('id', $row['id'])->value('request_fingerprint'));
    }

    #[Test]
    public function the_model_updates_a_legacy_row_but_refuses_to_add_metadata_to_it(): void
    {
        $this->migration()->down();
        $tenant = $this->commTenant();
        $row = $this->legacyCommMessageRow($tenant->id);
        DB::table('communication_messages')->insert($row);
        $this->migration()->up();
        app(TenantContext::class)->set($tenant->id);

        $legacy = CommunicationMessage::query()->findOrFail($row['id']);
        $legacy->last_error_code = 'timeout';
        $legacy->save();
        $this->assertSame('timeout', $legacy->fresh()->last_error_code);

        $legacy = CommunicationMessage::query()->findOrFail($row['id']);
        $legacy->forceFill(['request_fingerprint' => self::FP, 'hash_key_version' => 1]);
        $this->expectException(LogicException::class);
        $legacy->save();
    }

    #[Test]
    public function new_rows_after_the_extension_cannot_bypass_the_requirement(): void
    {
        $this->migration()->down();
        $tenant = $this->commTenant();
        DB::table('communication_messages')->insert($this->legacyCommMessageRow($tenant->id));
        $this->migration()->up();

        $this->commRejects(fn () => DB::table('communication_messages')->insert($this->legacyCommMessageRow($tenant->id)));
        $this->assertSame(1, DB::table('communication_messages')->count());
        $this->insertCommMessage($tenant->id);
        $this->assertSame(2, DB::table('communication_messages')->count());
    }

    #[Test]
    #[DataProvider('everyEnvironment')]
    public function rollback_is_refused_in_every_environment_when_any_row_carries_metadata(string $environment): void
    {
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id, ['request_fingerprint' => self::FP, 'hash_key_version' => 4]);
        $this->app['env'] = $environment;

        try {
            $this->migration()->down();
            $this->fail("rollback must be refused in {$environment}");
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Rollback refused', $e->getMessage());
            $this->assertStringNotContainsString(self::FP, $e->getMessage());
            $this->assertStringNotContainsString($id, $e->getMessage());
        }

        $this->assertTrue(Schema::hasColumn('communication_messages', 'request_fingerprint'));
        $this->assertSame(self::FP, trim((string) DB::table('communication_messages')->where('id', $id)->value('request_fingerprint')));
        $this->assertSame($this->postB1Triggers(), $this->commTriggerNames());
    }

    #[Test]
    public function rollback_with_only_legacy_rows_is_lossless_and_keeps_every_other_column(): void
    {
        $this->migration()->down();
        $tenant = $this->commTenant();
        $row = $this->legacyCommMessageRow($tenant->id);
        DB::table('communication_messages')->insert($row);
        $this->migration()->up();
        $before = (array) DB::table('communication_messages')->where('id', $row['id'])->first();
        unset($before['request_fingerprint'], $before['hash_key_version']);

        $this->migration()->down();

        $this->assertFalse(Schema::hasColumn('communication_messages', 'request_fingerprint'));
        $after = (array) DB::table('communication_messages')->where('id', $row['id'])->first();
        $this->assertEquals($before, $after);
    }

    #[Test]
    public function rollback_succeeds_on_empty_tables_in_every_environment_and_when_the_table_is_gone(): void
    {
        foreach (['production', 'staging', 'local', 'testing'] as $environment) {
            $this->app['env'] = $environment;
            $this->migration()->down();
            $this->assertFalse(Schema::hasColumn('communication_messages', 'request_fingerprint'));
            $this->migration()->up();
            $this->assertTrue(Schema::hasColumn('communication_messages', 'request_fingerprint'));
        }

        Schema::dropIfExists('communication_message_attempts');
        Schema::dropIfExists('communication_messages');
        $this->migration()->down();
        $this->assertFalse(Schema::hasTable('communication_messages'));
    }

    #[Test]
    public function postgres_enforces_the_constraints_and_the_insert_trigger_function_exists(): void
    {
        if ($this->commDriver() !== 'pgsql') {
            $this->markTestSkipped('قيود CHECK والدوال خاصة بـPostgreSQL.');
        }

        $names = DB::table('pg_constraint')->where('conrelid', DB::raw("'communication_messages'::regclass"))->pluck('conname')->all();
        foreach (['comm_msg_fingerprint_pair_chk', 'comm_msg_fingerprint_format_chk', 'comm_msg_hash_key_version_chk'] as $constraint) {
            $this->assertContains($constraint, $names);
        }
        $this->assertSame(1, DB::table('pg_proc')->where('proname', 'communication_messages_require_fingerprint')->count());

        $this->migration()->down();
        $this->assertSame(0, DB::table('pg_proc')->where('proname', 'communication_messages_require_fingerprint')->count());
        $this->assertSame([], array_values(array_filter(
            DB::table('pg_constraint')->where('conrelid', DB::raw("'communication_messages'::regclass"))->pluck('conname')->all(),
            fn (string $name) => str_contains($name, 'fingerprint') || $name === 'comm_msg_hash_key_version_chk'
        )));
    }

    #[Test]
    public function postgres_check_constraints_name_the_violated_rule(): void
    {
        if ($this->commDriver() !== 'pgsql') {
            $this->markTestSkipped('أسماء قيود CHECK خاصة بـPostgreSQL.');
        }
        $tenant = $this->commTenant();

        // Trigger الإدراج يسبق CHECK؛ لبلوغ قيد الزوج مباشرةً تُعطَّل الـTriggers داخل الـsavepoint فقط
        // (SET LOCAL يتراجع مع الـsavepoint عند الرفض).
        $pair = $this->commRejects(function () use ($tenant) {
            DB::statement("SET LOCAL session_replication_role = 'replica'");
            $this->insertCommMessage($tenant->id, ['hash_key_version' => null]);
        });
        $format = $this->commRejects(fn () => $this->insertCommMessage($tenant->id, ['request_fingerprint' => str_repeat('A', 64)]));
        $version = $this->commRejects(fn () => $this->insertCommMessage($tenant->id, ['hash_key_version' => 0]));

        $this->assertStringContainsString('comm_msg_fingerprint_pair_chk', $pair->getMessage());
        $this->assertStringContainsString('comm_msg_fingerprint_format_chk', $format->getMessage());
        $this->assertStringContainsString('comm_msg_hash_key_version_chk', $version->getMessage());
    }
}

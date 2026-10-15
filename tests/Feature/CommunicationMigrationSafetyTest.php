<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — سلامة الترحيل: إنشاء/إسقاط/إعادة إنشاء، ومنع التراجع المدمّر عند وجود بيانات.
 *
 * السياسة: `down()` يرفض حذف الجدولين متى وُجد أي صف في أيٍّ منهما، في **كل** البيئات (production/staging/
 * local/testing) وبلا أي علم أو إعداد تجاوز. لا توجد آلية اختبار مأهولة: من يريد تراجعاً يُفرغ الجدولين أولاً.
 *
 * DDL معاملاتي في المحرّكين، فتُنفَّذ هذه الاختبارات داخل معاملة `RefreshDatabase` وتُستعاد بعدها.
 */
class CommunicationMigrationSafetyTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_10_010000_create_communication_messages_tables.php';

    private const FINGERPRINT_MIGRATION = '2026_11_10_020000_add_request_fingerprint_to_communication_messages.php';

    /** @return array<string, array{0: string}> */
    public static function everyEnvironment(): array
    {
        return [
            'production' => ['production'],
            'staging' => ['staging'],
            'local' => ['local'],
            'testing' => ['testing'],
        ];
    }

    private function migration(): object
    {
        return require database_path('migrations/'.self::MIGRATION);
    }

    private function fingerprintMigration(): object
    {
        return require database_path('migrations/'.self::FINGERPRINT_MIGRATION);
    }

    /** ترتيب `migrate:rollback` الحقيقي: امتداد 02-B1 أولاً ثم 02-A. */
    private function rollbackAll(): void
    {
        $this->fingerprintMigration()->down();
        $this->migration()->down();
    }

    private function reapplyAll(): void
    {
        $this->migration()->up();
        $this->fingerprintMigration()->up();
    }

    private function tablesExist(): bool
    {
        return Schema::hasTable('communication_messages') && Schema::hasTable('communication_message_attempts');
    }

    /** @return list<string> */
    private function communicationFunctions(): array
    {
        return $this->commDriver() === 'pgsql'
            ? DB::table('pg_proc')->where('proname', 'like', 'communication_message%')->pluck('proname')->all()
            : [];
    }

    private function assertRollbackRefused(): void
    {
        try {
            $this->migration()->down();
            $this->fail('rollback of populated communications tables must be refused');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Rollback refused', $e->getMessage());
        }
    }

    /** كل الكائنات سليمة بعد الرفض: جداول، صفوف، Triggers، فهارس، (دوال PG). */
    private function assertEverythingIntact(int $messages, int $attempts): void
    {
        $this->assertTrue($this->tablesExist());
        $this->assertSame($messages, DB::table('communication_messages')->count());
        $this->assertSame($attempts, DB::table('communication_message_attempts')->count());
        $this->assertNotSame([], $this->commTriggerNames());
        $this->assertTrue($this->commIndexExists('comm_attempt_one_inflight'));
        if ($this->commDriver() === 'pgsql') {
            $this->assertCount(3, $this->communicationFunctions());
        }
    }

    #[Test]
    public function rollback_of_empty_tables_removes_every_object_and_reapplication_restores_them(): void
    {
        $this->assertTrue($this->tablesExist());
        $this->assertSame(0, DB::table('communication_messages')->count());

        $this->rollbackAll();

        $this->assertFalse(Schema::hasTable('communication_messages'));
        $this->assertFalse(Schema::hasTable('communication_message_attempts'));
        $this->assertSame([], $this->commTriggerNames());
        $this->assertSame([], $this->communicationFunctions());
        foreach (['comm_msg_tenant_id_unique', 'comm_msg_idem_unique', 'comm_attempt_no_unique', 'comm_attempt_one_inflight'] as $index) {
            $this->assertFalse($this->commIndexExists($index), "{$index} must be gone after rollback");
        }

        $this->reapplyAll();

        $this->assertTrue($this->tablesExist());
        $this->assertNotSame([], $this->commTriggerNames());
        $this->assertTrue($this->commIndexExists('comm_attempt_one_inflight'));

        // الكائنات المُعادة تعمل فعلاً (الهوية مثبّتة).
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);
        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update(['channel' => 'email']));
    }

    #[Test]
    #[DataProvider('everyEnvironment')]
    public function empty_tables_can_be_rolled_back_in_every_environment(string $environment): void
    {
        $this->app['env'] = $environment;

        $this->rollbackAll();

        $this->assertFalse(Schema::hasTable('communication_messages'));
        $this->assertFalse(Schema::hasTable('communication_message_attempts'));
    }

    #[Test]
    public function rolling_back_when_the_tables_are_already_absent_is_a_noop(): void
    {
        $this->rollbackAll();
        $this->rollbackAll();

        $this->assertFalse(Schema::hasTable('communication_messages'));
    }

    #[Test]
    public function reapplication_succeeds_after_tables_were_wiped_but_functions_remained(): void
    {
        if ($this->commDriver() !== 'pgsql') {
            $this->markTestSkipped('الدوال المتبقية بعد db:wipe خاصة بـPostgreSQL.');
        }

        // db:wipe يحذف الجداول ويترك الدوال؛ up() يستعمل CREATE OR REPLACE فلا يفشل.
        Schema::dropIfExists('communication_message_attempts');
        Schema::dropIfExists('communication_messages');
        $this->assertNotSame([], $this->communicationFunctions());

        $this->reapplyAll();

        $this->assertTrue($this->tablesExist());
        $this->assertSame(3, count($this->commTriggerNames()));
    }

    #[Test]
    #[DataProvider('everyEnvironment')]
    public function rollback_with_rows_is_refused_in_every_environment_and_nothing_is_dropped(string $environment): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $this->insertCommAttempt($tenant->id, $message);
        $this->app['env'] = $environment;

        try {
            $this->migration()->down();
            $this->fail("rollback must be refused in {$environment}");
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Rollback refused', $e->getMessage());
            // الرسالة لا تحوي قيماً من الصفوف.
            $this->assertStringNotContainsString($tenant->id, $e->getMessage());
            $this->assertStringNotContainsString($message, $e->getMessage());
        }

        $this->assertEverythingIntact(messages: 1, attempts: 1);
    }

    #[Test]
    public function a_single_message_without_attempts_is_enough_to_refuse_the_rollback(): void
    {
        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);

        $this->assertRollbackRefused();
        $this->assertEverythingIntact(messages: 1, attempts: 0);
    }

    #[Test]
    public function rollback_is_refused_even_when_the_attempts_table_was_removed_by_hand(): void
    {
        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);
        Schema::dropIfExists('communication_message_attempts');

        $this->assertRollbackRefused();
        $this->assertTrue(Schema::hasTable('communication_messages'));
        $this->assertSame(1, DB::table('communication_messages')->count());
    }

    #[Test]
    #[DataProvider('everyEnvironment')]
    public function no_flag_or_config_can_override_the_protection_in_any_environment(string $environment): void
    {
        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);
        $this->app['env'] = $environment;

        $flags = ['COMMUNICATIONS_ALLOW_DESTRUCTIVE_ROLLBACK', 'ALLOW_DESTRUCTIVE_ROLLBACK', 'FORCE'];
        foreach ($flags as $flag) {
            putenv("{$flag}=true");
            $_ENV[$flag] = 'true';
        }
        config(['communications.allow_destructive_rollback' => true]);

        try {
            $this->assertRollbackRefused();
            $this->assertEverythingIntact(messages: 1, attempts: 0);
        } finally {
            foreach ($flags as $flag) {
                putenv($flag);
                unset($_ENV[$flag]);
            }
        }
    }

    #[Test]
    public function the_artisan_rollback_command_is_blocked_for_a_populated_table_and_keeps_the_migration_recorded(): void
    {
        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);
        $name = pathinfo(self::MIGRATION, PATHINFO_FILENAME);
        $this->assertTrue(DB::table('migrations')->where('migration', $name)->exists());

        try {
            Artisan::call('migrate:rollback', ['--path' => 'database/migrations/'.self::MIGRATION, '--force' => true]);
            $this->fail('migrate:rollback must not drop populated communications tables');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('Rollback refused', $e->getMessage());
        }

        $this->assertTrue(DB::table('migrations')->where('migration', $name)->exists());
        $this->assertEverythingIntact(messages: 1, attempts: 0);
    }

    #[Test]
    public function the_only_way_to_roll_back_is_to_empty_the_tables_explicitly_first(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $this->insertCommAttempt($tenant->id, $message);
        $this->assertRollbackRefused();

        // تفريغ صريح (قرار واعٍ من المنفِّذ، لا من الـmigration): المحاولات تُحذف بالتتالي مع الرسالة.
        DB::table('communication_messages')->delete();
        $this->assertSame(0, DB::table('communication_message_attempts')->count());

        $this->rollbackAll();

        $this->assertFalse(Schema::hasTable('communication_messages'));
        $this->assertFalse(Schema::hasTable('communication_message_attempts'));
    }
}

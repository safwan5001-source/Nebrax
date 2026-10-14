<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * AWJ-COMMS-FOUNDATION-02-A — سلامة الترحيل: إنشاء/إسقاط/إعادة إنشاء، ومنع التراجع المدمّر عند وجود بيانات.
 *
 * DDL معاملاتي في المحرّكين، فتُنفَّذ هذه الاختبارات داخل معاملة `RefreshDatabase` وتُستعاد بعدها.
 */
class CommunicationMigrationSafetyTest extends TestCase
{
    use InteractsWithCommunicationSchema;
    use RefreshDatabase;

    private const MIGRATION = '2026_11_10_010000_create_communication_messages_tables.php';

    private function migration(): object
    {
        return require database_path('migrations/'.self::MIGRATION);
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

    #[Test]
    public function rollback_of_empty_tables_removes_every_object_and_reapplication_restores_them(): void
    {
        $this->assertTrue($this->tablesExist());

        $this->migration()->down();

        $this->assertFalse(Schema::hasTable('communication_messages'));
        $this->assertFalse(Schema::hasTable('communication_message_attempts'));
        $this->assertSame([], $this->commTriggerNames());
        $this->assertSame([], $this->communicationFunctions());
        foreach (['comm_msg_tenant_id_unique', 'comm_msg_idem_unique', 'comm_attempt_no_unique', 'comm_attempt_one_inflight'] as $index) {
            $this->assertFalse($this->commIndexExists($index), "{$index} must be gone after rollback");
        }

        $this->migration()->up();

        $this->assertTrue($this->tablesExist());
        $this->assertNotSame([], $this->commTriggerNames());
        $this->assertTrue($this->commIndexExists('comm_attempt_one_inflight'));

        // الكائنات المُعادة تعمل فعلاً (الهوية مثبّتة).
        $tenant = $this->commTenant();
        $id = $this->insertCommMessage($tenant->id);
        $this->commRejects(fn () => DB::table('communication_messages')->where('id', $id)->update(['channel' => 'email']));
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

        $this->migration()->up();

        $this->assertTrue($this->tablesExist());
        $this->assertSame(2, count($this->commTriggerNames()));
    }

    #[Test]
    public function rollback_with_rows_is_refused_in_production_and_nothing_is_dropped(): void
    {
        $tenant = $this->commTenant();
        $message = $this->insertCommMessage($tenant->id);
        $this->insertCommAttempt($tenant->id, $message);

        foreach (['production', 'staging'] as $environment) {
            $this->app['env'] = $environment;
            try {
                $this->migration()->down();
                $this->fail("rollback must be refused in {$environment}");
            } catch (RuntimeException $e) {
                $this->assertStringContainsString('Rollback refused', $e->getMessage());
                // الرسالة لا تحوي قيماً من الصفوف.
                $this->assertStringNotContainsString($tenant->id, $e->getMessage());
            }

            $this->assertTrue($this->tablesExist());
            $this->assertSame(1, DB::table('communication_messages')->count());
            $this->assertSame(1, DB::table('communication_message_attempts')->count());
            $this->assertNotSame([], $this->commTriggerNames());
        }
    }

    #[Test]
    public function an_environment_flag_alone_cannot_override_the_production_protection(): void
    {
        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);
        $this->app['env'] = 'production';

        foreach (['COMMUNICATIONS_ALLOW_DESTRUCTIVE_ROLLBACK', 'ALLOW_DESTRUCTIVE_ROLLBACK', 'FORCE'] as $flag) {
            putenv("{$flag}=true");
            $_ENV[$flag] = 'true';
        }
        config(['communications.allow_destructive_rollback' => true]);

        try {
            $this->migration()->down();
            $this->fail('no flag may override the production rollback protection');
        } catch (RuntimeException) {
            $this->assertTrue($this->tablesExist());
            $this->assertSame(1, DB::table('communication_messages')->count());
        } finally {
            foreach (['COMMUNICATIONS_ALLOW_DESTRUCTIVE_ROLLBACK', 'ALLOW_DESTRUCTIVE_ROLLBACK', 'FORCE'] as $flag) {
                putenv($flag);
                unset($_ENV[$flag]);
            }
        }
    }

    #[Test]
    public function a_populated_rollback_is_only_possible_in_local_or_testing_environments(): void
    {
        $tenant = $this->commTenant();
        $this->insertCommMessage($tenant->id);

        $this->app['env'] = 'local';
        $this->migration()->down();

        $this->assertFalse(Schema::hasTable('communication_messages'));
    }
}

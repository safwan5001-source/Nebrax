<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-COMMS-FOUNDATION-02-B1 — امتداد Schema لبصمة الطلب وإصدار مفتاح HMAC (Schema فقط).
 *
 * يضيف إلى `communication_messages` عمودين **nullable** فقط (لا جداول جديدة، لا فهارس، لا `recipient_hash`،
 * ولا تعديل لهجرة 02-A):
 *
 *  - `request_fingerprint` char(64)      HMAC-SHA256 مفتاحي (hex صغير) لتمثيل الطلب القياسي — يُحسب في 02-B.
 *  - `hash_key_version`    smallint      إصدار المفتاح الذي حُسبت به (≥ 1) — يلزم لإعادة الحساب بعد التدوير.
 *
 * لا حساب HMAC ولا مفاتيح ولا Enqueue هنا. القاعدة تفرض الشكل فقط:
 *
 *  1. **معاً أو لا شيء:** كلاهما NULL (صف قديم) أو كلاهما موجود.
 *  2. **صيغة صالحة:** `^[0-9a-f]{64}$` وإصدار بين 1 و32767.
 *  3. **ثابتان بعد الإدراج** (حتى `NULL` لا يتحول إلى قيمة): ضمن Trigger تثبيت الهوية.
 *  4. **الصفوف الجديدة لا تتجاوز البصمة:** Trigger `BEFORE INSERT` يرفض إدراجاً بلا بصمة.
 *
 * **لماذا Trigger إدراج لا `NOT NULL` ولا `CHECK … NOT VALID`:** العمودان nullable للتوافق مع الصفوف القديمة؛
 * وCHECK ‏`NOT VALID` على PostgreSQL يُفحص أيضاً عند **تحديث** صف قديم (تحقّقنا: يُجهض تحديث حالة صف NULL)، أي
 * يكسر دورة حياة أي صف سابق. Trigger الإدراج وحده يفرض الشرط على الصفوف الجديدة دون المساس بالقديمة.
 * لا Backfill: لا تُلفَّق بصمات لصفوف قديمة (لا نملك عناوينها الخام أصلاً).
 *
 * **SQLite:** `ALTER TABLE ADD COLUMN` الأصلي (بلا إعادة بناء الجدول) فتبقى الفهارس والـTriggers القائمة؛ ولا
 * يضيف CHECK بعد الإنشاء فتُفرض القواعد بـTriggers. Trigger الهوية يُعاد إنشاؤه بقائمة موسَّعة (DROP + CREATE) فقط.
 *
 * **التراجع:** يرفض إن حمل أي صف بصمة أو إصداراً (بيانات هذه الهجرة لا تُسقط)، ويسمح بصفوف قديمة (NULL/NULL)
 * لأنه بلا فقد. يعيد تعريفات 02-A الأصلية لـTrigger الهوية قبل حذف العمودين.
 */
return new class extends Migration
{
    private const MESSAGES = 'communication_messages';

    public function up(): void
    {
        Schema::table(self::MESSAGES, function (Blueprint $table) {
            $table->char('request_fingerprint', 64)->nullable();
            $table->unsignedSmallInteger('hash_key_version')->nullable();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->upPostgres();
        } else {
            $this->upSqlite();
        }
    }

    public function down(): void
    {
        $postgres = DB::connection()->getDriverName() === 'pgsql';

        if (Schema::hasTable(self::MESSAGES)) {
            if (Schema::hasColumn(self::MESSAGES, 'request_fingerprint')
                && DB::table(self::MESSAGES)->where(fn ($q) => $q->whereNotNull('request_fingerprint')->orWhereNotNull('hash_key_version'))->exists()) {
                throw new RuntimeException(
                    'Rollback refused: communication_messages rows carry request fingerprint metadata. '
                    .'Populated fingerprint metadata is never dropped by rollback in any environment; '
                    .'use a forward-only migration instead.'
                );
            }

            $postgres ? $this->downPostgres() : $this->downSqlite();

            Schema::table(self::MESSAGES, function (Blueprint $table) {
                $table->dropColumn(['request_fingerprint', 'hash_key_version']);
            });
        } elseif ($postgres) {
            // الجدول غائب (حُذف بتراجع 02-A أو db:wipe): تُنظَّف دالة هذه الهجرة المتبقية فقط.
            DB::statement('DROP FUNCTION IF EXISTS communication_messages_require_fingerprint()');
        }
    }

    // ───────────────────────────── PostgreSQL ─────────────────────────────

    private function upPostgres(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE communication_messages
                ADD CONSTRAINT comm_msg_fingerprint_pair_chk CHECK (
                    (request_fingerprint IS NULL) = (hash_key_version IS NULL)
                ),
                ADD CONSTRAINT comm_msg_fingerprint_format_chk CHECK (
                    request_fingerprint IS NULL OR request_fingerprint ~ '^[0-9a-f]{64}$'
                ),
                ADD CONSTRAINT comm_msg_hash_key_version_chk CHECK (
                    hash_key_version IS NULL OR hash_key_version >= 1
                )
            SQL);

        // تثبيت الهوية يشمل العمودين (حتى NULL → قيمة ممنوع). رسالة ثابتة بلا قيم؛ رمز P0001 الافتراضي.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION communication_messages_guard_identity() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.id IS DISTINCT FROM OLD.id
                    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                    OR NEW.channel IS DISTINCT FROM OLD.channel
                    OR NEW.classification IS DISTINCT FROM OLD.classification
                    OR NEW.template_key IS DISTINCT FROM OLD.template_key
                    OR NEW.source IS DISTINCT FROM OLD.source
                    OR NEW.idempotency_hash IS DISTINCT FROM OLD.idempotency_hash
                    OR NEW.recipient_masked IS DISTINCT FROM OLD.recipient_masked
                    OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
                    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
                    OR NEW.created_at IS DISTINCT FROM OLD.created_at
                    OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
                    OR NEW.hash_key_version IS DISTINCT FROM OLD.hash_key_version
                THEN
                    RAISE EXCEPTION 'communication_messages: identity columns are immutable';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION communication_messages_require_fingerprint() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.request_fingerprint IS NULL OR NEW.hash_key_version IS NULL THEN
                    RAISE EXCEPTION 'communication_messages: new rows require a request fingerprint';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared(
            'CREATE TRIGGER comm_msg_fingerprint_required BEFORE INSERT ON communication_messages '
            .'FOR EACH ROW EXECUTE FUNCTION communication_messages_require_fingerprint()'
        );
    }

    private function downPostgres(): void
    {
        DB::statement('DROP TRIGGER IF EXISTS comm_msg_fingerprint_required ON communication_messages');
        DB::statement('DROP FUNCTION IF EXISTS communication_messages_require_fingerprint()');

        // تعريف 02-A الأصلي لدالة الهوية (بلا العمودين) قبل حذفهما.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION communication_messages_guard_identity() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.id IS DISTINCT FROM OLD.id
                    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                    OR NEW.channel IS DISTINCT FROM OLD.channel
                    OR NEW.classification IS DISTINCT FROM OLD.classification
                    OR NEW.template_key IS DISTINCT FROM OLD.template_key
                    OR NEW.source IS DISTINCT FROM OLD.source
                    OR NEW.idempotency_hash IS DISTINCT FROM OLD.idempotency_hash
                    OR NEW.recipient_masked IS DISTINCT FROM OLD.recipient_masked
                    OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
                    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
                    OR NEW.created_at IS DISTINCT FROM OLD.created_at
                THEN
                    RAISE EXCEPTION 'communication_messages: identity columns are immutable';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE communication_messages
                DROP CONSTRAINT IF EXISTS comm_msg_fingerprint_pair_chk,
                DROP CONSTRAINT IF EXISTS comm_msg_fingerprint_format_chk,
                DROP CONSTRAINT IF EXISTS comm_msg_hash_key_version_chk
            SQL);
    }

    // ────────────────────────────── SQLite ───────────────────────────────

    /** شرط مخالفة الشكل (القيمة الجديدة): واحد من الاثنين، صيغة غير صالحة، أو إصدار غير صالح. */
    private const SQLITE_INVALID = <<<'SQL'
        ((NEW.request_fingerprint IS NULL) <> (NEW.hash_key_version IS NULL))
        OR (NEW.request_fingerprint IS NOT NULL AND (
                typeof(NEW.request_fingerprint) <> 'text'
                OR length(NEW.request_fingerprint) <> 64
                OR NEW.request_fingerprint GLOB '*[^0-9a-f]*'
            ))
        OR (NEW.hash_key_version IS NOT NULL AND (
                typeof(NEW.hash_key_version) <> 'integer'
                OR NEW.hash_key_version < 1
                OR NEW.hash_key_version > 32767
            ))
        SQL;

    private function upSqlite(): void
    {
        $invalid = self::SQLITE_INVALID;

        // الإدراج: بصمة مطلوبة + صالحة. التحديث: صالحة فقط (الصف القديم NULL/NULL يبقى قابلاً للتحديث).
        DB::unprepared(<<<SQL
            CREATE TRIGGER comm_msg_fingerprint_insert
            BEFORE INSERT ON communication_messages
            WHEN NEW.request_fingerprint IS NULL OR NEW.hash_key_version IS NULL OR ({$invalid})
            BEGIN
                SELECT RAISE(ABORT, 'communication_messages: new rows require a valid request fingerprint');
            END
            SQL);
        DB::unprepared(<<<SQL
            CREATE TRIGGER comm_msg_fingerprint_update
            BEFORE UPDATE ON communication_messages
            WHEN {$invalid}
            BEGIN
                SELECT RAISE(ABORT, 'communication_messages: request fingerprint metadata is invalid');
            END
            SQL);

        // تثبيت الهوية بقائمة موسَّعة: DROP + CREATE للـTrigger فقط (لا إعادة بناء للجدول).
        DB::unprepared('DROP TRIGGER comm_msg_identity_immutable');
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER comm_msg_identity_immutable
            BEFORE UPDATE OF id, tenant_id, channel, classification, template_key, source, idempotency_hash,
                             recipient_masked, max_attempts, expires_at, created_at, request_fingerprint, hash_key_version
            ON communication_messages
            WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.channel IS NOT OLD.channel
              OR NEW.classification IS NOT OLD.classification OR NEW.template_key IS NOT OLD.template_key
              OR NEW.source IS NOT OLD.source OR NEW.idempotency_hash IS NOT OLD.idempotency_hash
              OR NEW.recipient_masked IS NOT OLD.recipient_masked OR NEW.max_attempts IS NOT OLD.max_attempts
              OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
              OR NEW.request_fingerprint IS NOT OLD.request_fingerprint OR NEW.hash_key_version IS NOT OLD.hash_key_version
            BEGIN
                SELECT RAISE(ABORT, 'communication_messages: identity columns are immutable');
            END
            SQL);
    }

    private function downSqlite(): void
    {
        DB::unprepared('DROP TRIGGER IF EXISTS comm_msg_fingerprint_insert');
        DB::unprepared('DROP TRIGGER IF EXISTS comm_msg_fingerprint_update');

        // SQLite يرفض حذف عمود يشير إليه Trigger: يُعاد تعريف 02-A الأصلي أولاً.
        DB::unprepared('DROP TRIGGER IF EXISTS comm_msg_identity_immutable');
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER comm_msg_identity_immutable
            BEFORE UPDATE OF id, tenant_id, channel, classification, template_key, source, idempotency_hash,
                             recipient_masked, max_attempts, expires_at, created_at
            ON communication_messages
            WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.channel IS NOT OLD.channel
              OR NEW.classification IS NOT OLD.classification OR NEW.template_key IS NOT OLD.template_key
              OR NEW.source IS NOT OLD.source OR NEW.idempotency_hash IS NOT OLD.idempotency_hash
              OR NEW.recipient_masked IS NOT OLD.recipient_masked OR NEW.max_attempts IS NOT OLD.max_attempts
              OR NEW.expires_at IS NOT OLD.expires_at OR NEW.created_at IS NOT OLD.created_at
            BEGIN
                SELECT RAISE(ABORT, 'communication_messages: identity columns are immutable');
            END
            SQL);
    }
};

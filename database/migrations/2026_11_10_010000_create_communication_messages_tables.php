<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * AWJ-COMMS-FOUNDATION-02-A — أساس سجل الاتصالات (Schema فقط).
 *
 * جدولان إضافيان بحتان، بلا منطق إرسال ولا Routes ولا Jobs ولا Scheduler ولا مزوّد:
 *
 *  - `communication_messages`          رسالة واحدة = سجل Outbox واحد (نيّة + حالة تسليم + مطالبة/إيجار).
 *  - `communication_message_attempts`  محاولات الإرسال؛ تُلتزَم `started` قبل أي استدعاء للمزوّد.
 *
 * المرجع: docs/plans/communications/ADR-COMMS-01-*.md والعقود المدمجة في
 * `App\Support\Communications` (القيم أدناه مطابقة لـ`DeliveryStatus`/`DispatchOutcome` حرفياً —
 * يحرس ذلك `CommunicationSchemaTest`).
 *
 * ثوابت تفرضها **القاعدة** لا الكود وحده:
 *  - التفرّد: `(tenant_id, idempotency_hash)` ورقم المحاولة ومحاولة جارية واحدة لكل رسالة.
 *  - العزل: FK مركّبة `(tenant_id, message_id)` + Trigger يمنع تعديل `tenant_id` وأعمدة الهوية
 *    حتى عبر `DB::table()->update()` الذي لا يمرّ بأحداث النموذج.
 *  - الخصوصية: OTP بلا حمولة، `max_attempts=1`، ولا `retry_scheduled`؛ والحمولة لا توجد إلا في
 *    الحالات القابلة للإرسال (تُمسح في الجملة نفسها عند مغادرتها).
 *
 * **PostgreSQL** يفرض قواعد CHECK الشكلية كلها. **SQLite** لا يدعم إضافة CHECK بعد الإنشاء، فتُنفَّذ
 * فيه ثوابت الخصوصية بـTriggers، أما الشكلية (القوائم/المواعيد/الاستقرار) فيحرسها نموذج
 * `CommunicationMessage` — فجوة موثَّقة ومغطّاة باختبارات.
 *
 * لا `recipient_hash` ولا `hash_key_version` ولا `request_fingerprint` (مؤجَّلة لشريحة المفاتيح)،
 * ولا فهارس أدائية جزئية (تُضاف مع الاستعلامات التي تستعملها).
 *
 * **التراجع:** آمن حين يكون الجدولان فارغين. وجود أي صف يمنع الحذف خارج بيئتَي local/testing —
 * لا علم بيئة ولا تجاوز. بعد ظهور بيانات إنتاجية تكون التغييرات إلى الأمام فقط (expand-then-contract).
 */
return new class extends Migration
{
    private const MESSAGES = 'communication_messages';

    private const ATTEMPTS = 'communication_message_attempts';

    public function up(): void
    {
        Schema::create(self::MESSAGES, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            $table->string('channel', 16);
            $table->string('classification', 16);
            $table->string('template_key', 128);
            $table->string('source', 128);
            // sha256(tenant ⏎ key) — المفتاح الخام لا يُخزَّن.
            $table->char('idempotency_hash', 64);
            // MessageRecipient::masked() وحده؛ 320 = MessageRecipient::MAX_LENGTH.
            $table->string('recipient_masked', 320);
            // encrypted:array {address, variables}؛ NULL دائماً لـOTP، وموجودة فقط في الحالات القابلة للإرسال.
            $table->text('payload_encrypted')->nullable();
            $table->string('status', 24)->default('queued');
            $table->unsignedSmallInteger('attempt_count')->default(0);
            $table->unsignedSmallInteger('max_attempts');
            $table->timestamp('next_attempt_at')->nullable();
            $table->timestamp('expires_at');
            // fencing + إيجار المطالبة؛ إلزاميان في `sending` فقط.
            $table->uuid('lease_token')->nullable();
            $table->timestamp('lease_until')->nullable();
            // رمز مصنَّف فقط — لا نص حرّ من المزوّد.
            $table->string('last_error_code', 64)->nullable();
            $table->timestamp('accepted_at')->nullable();
            // نهاية نافذة انتظار الإيصال المتوقَّعة — ليست موعد فشل ولا انتهاء صلاحية.
            $table->timestamp('receipt_deadline_at')->nullable();
            // بداية ساعة الاحتفاظ (مستقلة عن `status`): final_status | receipt_window_elapsed.
            $table->timestamp('settled_at')->nullable();
            $table->string('settled_reason', 32)->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'id'], 'comm_msg_tenant_id_unique');
            $table->unique(['tenant_id', 'idempotency_hash'], 'comm_msg_idem_unique');
        });

        Schema::create(self::ATTEMPTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('message_id');
            $table->unsignedSmallInteger('attempt_no');
            $table->string('provider_key', 64);
            $table->string('outcome', 24)->default('started');
            $table->string('error_code', 64)->nullable();
            $table->string('provider_message_id', 191)->nullable();
            $table->timestamp('started_at');
            $table->timestamp('finished_at')->nullable();

            // عزل المستأجر في القاعدة: لا محاولة تشير إلى رسالة مستأجر آخر.
            $table->foreign(['tenant_id', 'message_id'], 'comm_attempt_message_fk')
                ->references(['tenant_id', 'id'])->on(self::MESSAGES)->cascadeOnDelete();
            $table->unique(['tenant_id', 'message_id', 'attempt_no'], 'comm_attempt_no_unique');
        });

        // محاولة جارية واحدة لكل رسالة — محمول في المحرّكين (نمط customer_otp_codes).
        DB::statement(
            'CREATE UNIQUE INDEX comm_attempt_one_inflight ON '.self::ATTEMPTS." (message_id) WHERE outcome = 'started'"
        );

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        if ($this->hasRows() && ! app()->environment(['local', 'testing'])) {
            throw new RuntimeException(
                'Rollback refused: communication_messages / communication_message_attempts contain rows. '
                .'Destructive rollback of populated communications tables is not permitted outside local/testing; '
                .'use a forward-only migration instead.'
            );
        }

        Schema::dropIfExists(self::ATTEMPTS);
        Schema::dropIfExists(self::MESSAGES);

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS communication_message_attempts_guard()');
            DB::statement('DROP FUNCTION IF EXISTS communication_messages_guard_identity()');
        }
    }

    private function hasRows(): bool
    {
        foreach ([self::ATTEMPTS, self::MESSAGES] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                return true;
            }
        }

        return false;
    }

    private function createPostgresGuards(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE communication_messages
                ADD CONSTRAINT comm_msg_enums_chk CHECK (
                    channel IN ('sms','whatsapp','email','push')
                    AND classification IN ('otp','transactional','service','marketing')
                    AND status IN ('queued','sending','accepted','delivered','read','failed_retryable','retry_scheduled','failed_permanent','undeliverable','expired','blocked_policy','cancelled','unknown')
                    AND (settled_reason IS NULL OR settled_reason IN ('final_status','receipt_window_elapsed'))
                ),
                ADD CONSTRAINT comm_msg_otp_privacy_chk CHECK (
                    classification <> 'otp' OR (payload_encrypted IS NULL AND max_attempts = 1 AND status <> 'retry_scheduled')
                ),
                ADD CONSTRAINT comm_msg_payload_lifecycle_chk CHECK (
                    payload_encrypted IS NULL OR status IN ('queued','retry_scheduled','sending','failed_retryable')
                ),
                ADD CONSTRAINT comm_msg_deferred_payload_chk CHECK (
                    classification = 'otp' OR status NOT IN ('queued','retry_scheduled') OR payload_encrypted IS NOT NULL
                ),
                ADD CONSTRAINT comm_msg_attempts_chk CHECK (
                    max_attempts >= 1 AND attempt_count >= 0 AND attempt_count <= max_attempts
                ),
                ADD CONSTRAINT comm_msg_lease_chk CHECK (
                    (status = 'sending' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
                    OR (status <> 'sending' AND lease_token IS NULL AND lease_until IS NULL)
                ),
                ADD CONSTRAINT comm_msg_due_chk CHECK (
                    status NOT IN ('queued','retry_scheduled') OR next_attempt_at IS NOT NULL
                ),
                ADD CONSTRAINT comm_msg_receipt_chk CHECK (
                    (status NOT IN ('accepted','unknown','delivered') OR receipt_deadline_at IS NOT NULL)
                    AND (status <> 'accepted' OR accepted_at IS NOT NULL)
                ),
                ADD CONSTRAINT comm_msg_settled_chk CHECK (
                    (status NOT IN ('read','failed_permanent','undeliverable','expired','blocked_policy','cancelled') OR settled_at IS NOT NULL)
                    AND ((settled_at IS NULL) = (settled_reason IS NULL))
                )
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE communication_message_attempts
                ADD CONSTRAINT comm_attempt_outcome_chk CHECK (
                    outcome IN ('started','accepted','retryable_failure','permanent_failure','unsupported','unknown','abandoned')
                    AND attempt_no >= 1
                    AND ((outcome = 'started') = (finished_at IS NULL))
                )
            SQL);

        // رسائل الأخطاء ثابتة النص عمداً: لا استيفاء لقيم OLD/NEW (لا تسريب عبر الاستثناءات/السجلات).
        // رمز الاستثناء الافتراضي P0001 لا يلتبس بـ23000/23505 (تعارض التفرّد) في معالجات الخدمات.
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
        DB::unprepared(
            'CREATE TRIGGER comm_msg_identity_immutable BEFORE UPDATE ON communication_messages '
            .'FOR EACH ROW EXECUTE FUNCTION communication_messages_guard_identity()'
        );

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION communication_message_attempts_guard() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.outcome <> 'started' THEN
                    RAISE EXCEPTION 'communication_message_attempts: finalized attempts are immutable';
                END IF;
                IF NEW.id IS DISTINCT FROM OLD.id
                    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                    OR NEW.message_id IS DISTINCT FROM OLD.message_id
                    OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
                    OR NEW.provider_key IS DISTINCT FROM OLD.provider_key
                    OR NEW.started_at IS DISTINCT FROM OLD.started_at
                THEN
                    RAISE EXCEPTION 'communication_message_attempts: identity columns are immutable';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared(
            'CREATE TRIGGER comm_attempt_guard BEFORE UPDATE ON communication_message_attempts '
            .'FOR EACH ROW EXECUTE FUNCTION communication_message_attempts_guard()'
        );
    }

    private function createSqliteGuards(): void
    {
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

        // بديل CHECK الخصوصية (SQLite لا يضيف CHECK بعد الإنشاء): إدراجاً وتحديثاً.
        foreach (['INSERT' => 'insert', 'UPDATE' => 'update'] as $event => $suffix) {
            DB::unprepared(<<<SQL
                CREATE TRIGGER comm_msg_privacy_{$suffix}
                BEFORE {$event} ON communication_messages
                WHEN (NEW.classification = 'otp' AND (NEW.payload_encrypted IS NOT NULL OR NEW.max_attempts <> 1 OR NEW.status = 'retry_scheduled'))
                  OR (NEW.payload_encrypted IS NOT NULL AND NEW.status NOT IN ('queued','retry_scheduled','sending','failed_retryable'))
                BEGIN
                    SELECT RAISE(ABORT, 'communication_messages: privacy invariant violated');
                END
                SQL);
        }

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER comm_attempt_guard
            BEFORE UPDATE ON communication_message_attempts
            WHEN OLD.outcome <> 'started'
              OR NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.message_id IS NOT OLD.message_id
              OR NEW.attempt_no IS NOT OLD.attempt_no OR NEW.provider_key IS NOT OLD.provider_key
              OR NEW.started_at IS NOT OLD.started_at
            BEGIN
                SELECT RAISE(ABORT, 'communication_message_attempts: finalized attempts or identity columns are immutable');
            END
            SQL);
    }
};

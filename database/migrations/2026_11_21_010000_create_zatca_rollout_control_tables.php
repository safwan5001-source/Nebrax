<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * REM-18b-3a — أساس ضوابط تفعيل ZATCA (التفعيل مُعطَّل افتراضياً): **مخطط فقط**.
 *
 * جدولان إضافيان بحتان لا يقرؤهما ولا يكتبهما أي مسار ترحيل قائم:
 *
 *  - `zatca_rollout_controls`        حالة تفعيل واحدة لكل (نطاق، مستأجر، ميزة): نطاق `tenant` لتفعيل مستأجر، ونطاق `platform`
 *                                    للإيقاف الطارئ العام. الميزة الوحيدة الآن: `credit_note_issuance`.
 *  - `zatca_rollout_control_events`  سجل تدقيق append-only: كل تغيير حالة (الفاعل، اللحظة، الحالة السابقة والجديدة، السبب).
 *
 * **الهجرة لا تُدرج أي صف.** لا مستأجر يصير «مفعَّلاً» بالنشر: غياب صف المستأجر = معطَّل. ولا يُفعِّل `INSERT` وحده شيئاً —
 * القاعدة ترفض إنشاء ضابط مستأجر مفعَّلاً؛ التفعيل لا يكون إلا بحدث تدقيق مقابل (انظر C3 أدناه).
 *
 * ═══ دلالة الحالة ═══
 *  - مستأجر: `enabled = true` ⇒ التفعيل مسموح لهذا المستأجر. غياب الصف ⇒ **معطَّل**.
 *  - منصة: `enabled = false` ⇒ **إيقاف طارئ** عام يُلغي كل تفعيل مستأجر. غياب الصف ⇒ لا إيقاف مسجَّل (الحالة الأساسية).
 *  الحالة الفعّالة = صف المستأجر `enabled` **و**ليس إيقاف منصة (`ZatcaRolloutControlService`، قراءة بعبارة SQL واحدة).
 *
 * ═══ ما تفرضه القاعدة لا الكود وحده (مُشغّلات بالمحرّكين) ═══
 *  U   تفرّد الهوية: فهرس فريد جزئي لكل (مستأجر، ميزة) وآخر لنطاق المنصة (القيمة NULL في `tenant_id` لا تتفرّد في فهرس عادي).
 *  C1  CHECK الشكل: نطاق ∈ {platform, tenant}؛ المنصة بلا `tenant_id` والمستأجر معه؛ ميزة معروفة فقط.
 *  C2  إدراج الضابط لا يكون إلا في الحالة الأساسية بنسخة 0 (مستأجر معطَّل، منصة بلا إيقاف): الإدراج وحده لا يُفعِّل شيئاً ولا يوقف شيئاً.
 *  C3  تغيّر `enabled` لا يحدث إلا بإدراج حدث تدقيق مقابل: المُشغّل AFTER INSERT على الأحداث يطبّق الحالة بمقارنة-وتبديل
 *      (النسخة السابقة + الحالة السابقة + الهوية)، فلا تفعيل بلا حدث ولا حدث بلا تغيير ولا تسابق يطبّق حدثين على النسخة نفسها.
 *      وUPDATE المباشر على الضابط مرفوض ما لم يطابق حدثاً مُدرجاً بالنسخة التالية؛ هويته مجمّدة.
 *  C4  DELETE على الضابط مرفوض (المنصة دائماً؛ المستأجر ما دام صفه موجوداً) فلا يزول إيقاف طارئ ولا تفعيل بصمت. TRUNCATE مرفوض (PostgreSQL).
 *  E1  UPDATE على الأحداث مرفوض دائماً.  E2  DELETE مرفوض (أحداث المنصة دائماً؛ المستأجر ما دام صفه موجوداً — الحذف المتسلسل يمرّ).
 *  E3  TRUNCATE مرفوض (PostgreSQL).  E4  CHECK الشكل: نسخة ≥ 1، الحالتان مختلفتان، سبب 3–500 حرفاً، النطاق/المستأجر/الميزة كالضابط.
 *
 * ═══ العزل ═══
 *  `tenant_id` → `tenants` **CASCADE** كبقية الجداول (حذف المستأجر النهائي يزيل ضوابطه وأحداثه معاً؛ خطر الاحتفاظ الموثَّق في REM-36 لا يتغيّر).
 *  لا نموذج مستأجر ولا مسار API للمستأجر: النموذجان تشغيليان للمنصة (كنماذج `Platform*`) ولا يمرّان بنطاق `SetTenant`.
 *
 * ═══ التراجع ═══
 *  `down()` يرفض متى وُجد أي صف في الجدولين، في كل البيئات وبلا علم تجاوز (نمط REM-18b-1).
 */
return new class extends Migration
{
    private const CONTROLS = 'zatca_rollout_controls';

    private const EVENTS = 'zatca_rollout_control_events';

    public function up(): void
    {
        Schema::create(self::CONTROLS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('scope', 16);                       // platform | tenant
            $table->foreignUuid('tenant_id')->nullable()->constrained('tenants')->cascadeOnDelete();
            $table->string('feature_key', 64);                 // credit_note_issuance
            $table->boolean('enabled')->default(false);
            $table->unsignedInteger('version')->default(0);    // = عدد أحداثه؛ مفتاح المقارنة-والتبديل
            $table->timestamps();
        });

        Schema::create(self::EVENTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('control_id')->constrained(self::CONTROLS)->restrictOnDelete();
            $table->string('scope', 16);
            $table->foreignUuid('tenant_id')->nullable()->constrained('tenants')->cascadeOnDelete();
            $table->string('feature_key', 64);
            $table->unsignedInteger('version');
            $table->boolean('previous_enabled');
            $table->boolean('new_enabled');
            // سجل تدقيق: حذف مدير منصة نهائياً لا يمحو أثره (الحسابات تُعطَّل بالحذف الناعم).
            $table->foreignUuid('platform_administrator_id')->constrained('platform_administrators')->restrictOnDelete();
            $table->string('reason', 500);
            $table->timestamp('occurred_at');
            $table->timestamp('created_at')->nullable();        // لا updated_at: الحدث لا يتغيّر

            $table->unique(['control_id', 'version'], 'zatca_rollout_event_version_unique');
            $table->index(['tenant_id', 'occurred_at'], 'zatca_rollout_event_tenant_idx');
            $table->index(['feature_key', 'occurred_at'], 'zatca_rollout_event_feature_idx');
        });

        // تفرّد الهوية (U): فهرسان جزئيان يعملان على المحرّكين بالصياغة نفسها.
        DB::statement('CREATE UNIQUE INDEX zatca_rollout_tenant_feature_unique ON '.self::CONTROLS.' (tenant_id, feature_key) WHERE tenant_id IS NOT NULL');
        DB::statement("CREATE UNIQUE INDEX zatca_rollout_platform_feature_unique ON ".self::CONTROLS." (feature_key) WHERE scope = 'platform'");

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        foreach ([self::EVENTS, self::CONTROLS] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException(
                    'Rollback refused: zatca_rollout_controls / zatca_rollout_control_events contain rows. '
                    .'Rollout controls and their audit history are never dropped by rollback in any environment; use a forward-only migration instead.'
                );
            }
        }

        Schema::dropIfExists(self::EVENTS);
        Schema::dropIfExists(self::CONTROLS);

        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ([
                'zatca_rollout_controls_guard_insert', 'zatca_rollout_controls_guard_update', 'zatca_rollout_controls_guard_delete',
                'zatca_rollout_events_guard_update', 'zatca_rollout_events_guard_delete', 'zatca_rollout_events_apply',
                'zatca_rollout_guard_truncate',
            ] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }
        }
    }

    private function createPostgresGuards(): void
    {
        // C1 / E4
        DB::statement(<<<'SQL'
            ALTER TABLE zatca_rollout_controls
                ADD CONSTRAINT zatca_rollout_control_shape_chk CHECK (
                    scope IN ('platform','tenant')
                    AND ((scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL))
                    AND feature_key IN ('credit_note_issuance')
                    AND version >= 0
                )
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE zatca_rollout_control_events
                ADD CONSTRAINT zatca_rollout_event_shape_chk CHECK (
                    scope IN ('platform','tenant')
                    AND ((scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL))
                    AND feature_key IN ('credit_note_issuance')
                    AND version >= 1
                    AND previous_enabled <> new_enabled
                    AND char_length(btrim(reason)) BETWEEN 3 AND 500
                )
            SQL);

        // C2: الإدراج في الحالة الأساسية فقط.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_controls_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.version <> 0
                    OR (NEW.scope = 'tenant' AND NEW.enabled)
                    OR (NEW.scope = 'platform' AND NOT NEW.enabled)
                THEN
                    RAISE EXCEPTION 'zatca_rollout_controls: a control is created in its baseline state and changes only through an audit event';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_control_baseline BEFORE INSERT ON zatca_rollout_controls FOR EACH ROW EXECUTE FUNCTION zatca_rollout_controls_guard_insert()');

        // C3: التحديث المباشر مرفوض ما لم يطابق حدثاً مُدرجاً بالنسخة التالية؛ الهوية مجمّدة.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_controls_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.id IS DISTINCT FROM OLD.id
                    OR NEW.scope IS DISTINCT FROM OLD.scope
                    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                    OR NEW.feature_key IS DISTINCT FROM OLD.feature_key
                    OR NEW.created_at IS DISTINCT FROM OLD.created_at
                    OR NEW.version <> OLD.version + 1
                    OR NOT EXISTS (
                        SELECT 1 FROM zatca_rollout_control_events e
                         WHERE e.control_id = NEW.id AND e.version = NEW.version
                           AND e.previous_enabled = OLD.enabled AND e.new_enabled = NEW.enabled
                    )
                THEN
                    RAISE EXCEPTION 'zatca_rollout_controls: state changes only through a matching audit event';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_control_update_guard BEFORE UPDATE ON zatca_rollout_controls FOR EACH ROW EXECUTE FUNCTION zatca_rollout_controls_guard_update()');

        // C4 / E2: المنصة دائماً مرفوض؛ المستأجر ما دام صفه موجوداً (حذف المستأجر المتسلسل يمرّ).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_controls_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'zatca_rollout_controls: rollout controls cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_control_no_delete BEFORE DELETE ON zatca_rollout_controls FOR EACH ROW EXECUTE FUNCTION zatca_rollout_controls_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_events_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'zatca_rollout_control_events: audit events are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_event_no_update BEFORE UPDATE ON zatca_rollout_control_events FOR EACH ROW EXECUTE FUNCTION zatca_rollout_events_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_events_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'zatca_rollout_control_events: audit events cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_event_no_delete BEFORE DELETE ON zatca_rollout_control_events FOR EACH ROW EXECUTE FUNCTION zatca_rollout_events_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'zatca rollout tables cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_control_no_truncate BEFORE TRUNCATE ON zatca_rollout_controls FOR EACH STATEMENT EXECUTE FUNCTION zatca_rollout_guard_truncate()');
        DB::unprepared('CREATE TRIGGER zatca_rollout_event_no_truncate BEFORE TRUNCATE ON zatca_rollout_control_events FOR EACH STATEMENT EXECUTE FUNCTION zatca_rollout_guard_truncate()');

        // C3: الحدث يطبّق حالته على الضابط ذرّياً بمقارنة-وتبديل على (الهوية، النسخة السابقة، الحالة السابقة).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_rollout_events_apply() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                UPDATE zatca_rollout_controls
                   SET enabled = NEW.new_enabled, version = NEW.version, updated_at = CURRENT_TIMESTAMP
                 WHERE id = NEW.control_id AND scope = NEW.scope AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
                   AND feature_key = NEW.feature_key AND version = NEW.version - 1 AND enabled = NEW.previous_enabled;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'zatca_rollout_control_events: the event does not match the current control state and version';
                END IF;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_rollout_event_apply AFTER INSERT ON zatca_rollout_control_events FOR EACH ROW EXECUTE FUNCTION zatca_rollout_events_apply()');
    }

    private function createSqliteGuards(): void
    {
        // C1 / E4 (SQLite لا يضيف CHECK بعد الإنشاء): مُشغّلا إدراج بالشروط نفسها؛ NULL يُعامَل فشلاً.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_control_shape BEFORE INSERT ON zatca_rollout_controls
            WHEN COALESCE(NOT (
                NEW.scope IN ('platform','tenant')
                AND ((NEW.scope = 'platform' AND NEW.tenant_id IS NULL) OR (NEW.scope = 'tenant' AND NEW.tenant_id IS NOT NULL))
                AND NEW.feature_key IN ('credit_note_issuance')
                AND NEW.version >= 0
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_controls: invalid control shape');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_event_shape BEFORE INSERT ON zatca_rollout_control_events
            WHEN COALESCE(NOT (
                NEW.scope IN ('platform','tenant')
                AND ((NEW.scope = 'platform' AND NEW.tenant_id IS NULL) OR (NEW.scope = 'tenant' AND NEW.tenant_id IS NOT NULL))
                AND NEW.feature_key IN ('credit_note_issuance')
                AND NEW.version >= 1
                AND NEW.previous_enabled <> NEW.new_enabled
                AND length(trim(NEW.reason)) BETWEEN 3 AND 500
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_control_events: invalid event shape');
            END
            SQL);

        // C2
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_control_baseline BEFORE INSERT ON zatca_rollout_controls
            WHEN NEW.version <> 0
              OR (NEW.scope = 'tenant' AND NEW.enabled <> 0)
              OR (NEW.scope = 'platform' AND NEW.enabled = 0)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_controls: a control is created in its baseline state and changes only through an audit event');
            END
            SQL);

        // C3
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_control_update_guard BEFORE UPDATE ON zatca_rollout_controls
            WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.tenant_id IS NOT OLD.tenant_id
              OR NEW.feature_key IS NOT OLD.feature_key OR NEW.created_at IS NOT OLD.created_at
              OR NEW.version <> OLD.version + 1
              OR NOT EXISTS (
                  SELECT 1 FROM zatca_rollout_control_events e
                   WHERE e.control_id = NEW.id AND e.version = NEW.version
                     AND e.previous_enabled = OLD.enabled AND e.new_enabled = NEW.enabled
              )
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_controls: state changes only through a matching audit event');
            END
            SQL);

        // C4 / E2
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_control_no_delete BEFORE DELETE ON zatca_rollout_controls
            WHEN OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_controls: rollout controls cannot be deleted');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_event_no_delete BEFORE DELETE ON zatca_rollout_control_events
            WHEN OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_control_events: audit events cannot be deleted');
            END
            SQL);

        // E1
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_event_no_update BEFORE UPDATE ON zatca_rollout_control_events
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_control_events: audit events are immutable');
            END
            SQL);

        // C3: الحدث يطبّق حالته ذرّياً بمقارنة-وتبديل.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_rollout_event_apply AFTER INSERT ON zatca_rollout_control_events
            BEGIN
                SELECT RAISE(ABORT, 'zatca_rollout_control_events: the event does not match the current control state and version')
                 WHERE NOT EXISTS (
                     SELECT 1 FROM zatca_rollout_controls
                      WHERE id = NEW.control_id AND scope = NEW.scope AND tenant_id IS NEW.tenant_id
                        AND feature_key = NEW.feature_key AND version = NEW.version - 1 AND enabled = NEW.previous_enabled
                 );
                UPDATE zatca_rollout_controls
                   SET enabled = NEW.new_enabled, version = NEW.version, updated_at = CURRENT_TIMESTAMP
                 WHERE id = NEW.control_id;
            END
            SQL);
    }
};

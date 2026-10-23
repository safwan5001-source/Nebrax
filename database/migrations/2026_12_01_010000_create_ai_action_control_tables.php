<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * IMP-X-01a — ضوابط المشغّل لإجراءات المساعد (AI Actions): **مخطط فقط**، لا يقرؤه ولا يكتبه أي مسار قائم.
 *
 * جدولان إضافيان بحتان (نمط `payments_rollout_*` نفسه، دون مسّه):
 *  - `ai_action_controls`        حالة واحدة لكل (نطاق، مستأجر، نوع إجراء، قدرة): نطاق `platform` للتحكم العام (نوع `*` = المفتاح الرئيسي، أو نوع بعينه = توفّر النوع)،
 *                                ونطاق `tenant` لمنحة المستأجر لنوع بعينه. القدرة: `use` (المعاينة والمراجعة) أو `execution` (التشغيل الذي يكتب بيانات).
 *  - `ai_action_control_events`  سجل تدقيق append-only: كل تغيير (الفاعل، اللحظة، الحالة السابقة والجديدة، السبب).
 *
 * **الافتراضي رفض (قرار المالك D-11):** الحالة الأساسية لكل ضابط `enabled = false` ولغياب الصف المعنى نفسه؛ التفعيل «منحة» صريحة لا تكون إلا بحدث تدقيق.
 * الهجرة لا تُدرج أي صف. هذه الضوابط شرط لازم لا كافٍ: لا تمنح صلاحية ولا توسّع نطاق فرع ولا تتجاوز المعاينة والموافقة قبل التنفيذ، وأعلام البيئة تبقى أرضية صلبة (D-10).
 *
 * ما تفرضه القاعدة لا الكود وحده (مُشغّلات بالمحرّكين، كنمط المدفوعات):
 *  U   تفرّد الهوية: فهرس فريد جزئي لكل (مستأجر، نوع، قدرة) وآخر لنطاق المنصة.
 *  C1  CHECK الشكل: نطاق ∈ {platform, tenant}؛ المنصة بلا `tenant_id` والمستأجر معه؛ قدرة معروفة؛ نوع 1–64 حرفاً؛ ومنحة المستأجر لنوع بعينه (لا `*`).
 *  C2  الإدراج في الحالة الأساسية فقط (`enabled = false`، نسخة 0): الإدراج وحده لا يمنح شيئاً.
 *  C3  تغيّر `enabled` لا يحدث إلا بإدراج حدث تدقيق مقابل (مقارنة-وتبديل بالنسخة)؛ UPDATE المباشر مرفوض والهوية مجمّدة.
 *  C4  DELETE على الضابط مرفوض (ما دام مستأجره موجوداً)؛ TRUNCATE مرفوض (PostgreSQL).
 *  E1–E4 الأحداث: UPDATE مرفوض دائماً، DELETE/TRUNCATE كالضوابط، وCHECK الشكل (نسخة ≥ 1، الحالتان مختلفتان، سبب 3–500 حرفاً).
 *
 * العزل: `tenant_id` → `tenants` CASCADE كبقية الجداول. نموذجان تشغيليان للمنصة بلا نطاق مستأجر تلقائي ولا مسار API للمستأجر.
 * التراجع: `down()` يرفض متى وُجد أي صف في الجدولين، في كل البيئات وبلا علم تجاوز.
 */
return new class extends Migration
{
    private const CONTROLS = 'ai_action_controls';

    private const EVENTS = 'ai_action_control_events';

    public function up(): void
    {
        Schema::create(self::CONTROLS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('scope', 16);                       // platform | tenant
            $table->foreignUuid('tenant_id')->nullable()->constrained('tenants')->cascadeOnDelete();
            $table->string('action_type', 64);                 // '*' = كل الأنواع (منصة فقط) أو نوع مسجَّل في AiActionRegistry
            $table->string('capability', 16);                  // use | execution
            $table->boolean('enabled')->default(false);
            $table->unsignedInteger('version')->default(0);    // = عدد أحداثه؛ مفتاح المقارنة-والتبديل
            $table->timestamps();
        });

        Schema::create(self::EVENTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('control_id')->constrained(self::CONTROLS)->restrictOnDelete();
            $table->string('scope', 16);
            $table->foreignUuid('tenant_id')->nullable()->constrained('tenants')->cascadeOnDelete();
            $table->string('action_type', 64);
            $table->string('capability', 16);
            $table->unsignedInteger('version');
            $table->boolean('previous_enabled');
            $table->boolean('new_enabled');
            // سجل تدقيق: حذف مدير منصة نهائياً لا يمحو أثره (الحسابات تُعطَّل بالحذف الناعم).
            $table->foreignUuid('platform_administrator_id')->constrained('platform_administrators')->restrictOnDelete();
            $table->string('reason', 500);
            $table->timestamp('occurred_at');
            $table->timestamp('created_at')->nullable();        // لا updated_at: الحدث لا يتغيّر

            $table->unique(['control_id', 'version'], 'ai_action_control_event_version_unique');
            $table->index(['tenant_id', 'occurred_at'], 'ai_action_control_event_tenant_idx');
            $table->index(['action_type', 'capability', 'occurred_at'], 'ai_action_control_event_type_idx');
        });

        // تفرّد الهوية (U): فهرسان جزئيان يعملان على المحرّكين بالصياغة نفسها.
        DB::statement('CREATE UNIQUE INDEX ai_action_control_tenant_unique ON '.self::CONTROLS.' (tenant_id, action_type, capability) WHERE tenant_id IS NOT NULL');
        DB::statement("CREATE UNIQUE INDEX ai_action_control_platform_unique ON ".self::CONTROLS." (action_type, capability) WHERE scope = 'platform'");

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
                    'Rollback refused: ai_action_controls / ai_action_control_events contain rows. '
                    .'Rollout controls and their audit history are never dropped by rollback in any environment; use a forward-only migration instead.'
                );
            }
        }

        Schema::dropIfExists(self::EVENTS);
        Schema::dropIfExists(self::CONTROLS);

        if (DB::connection()->getDriverName() === 'pgsql') {
            foreach ([
                'ai_action_controls_guard_insert', 'ai_action_controls_guard_update', 'ai_action_controls_guard_delete',
                'ai_action_control_events_guard_update', 'ai_action_control_events_guard_delete', 'ai_action_control_events_apply',
                'ai_action_control_guard_truncate',
            ] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }
        }
    }

    private function createPostgresGuards(): void
    {
        // C1 / E4
        DB::statement(<<<'SQL'
            ALTER TABLE ai_action_controls
                ADD CONSTRAINT ai_action_control_control_shape_chk CHECK (
                    scope IN ('platform','tenant')
                    AND ((scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL))
                    AND char_length(action_type) BETWEEN 1 AND 64 AND capability IN ('use','execution') AND (scope = 'platform' OR action_type <> '*')
                    AND version >= 0
                )
            SQL);
        DB::statement(<<<'SQL'
            ALTER TABLE ai_action_control_events
                ADD CONSTRAINT ai_action_control_event_shape_chk CHECK (
                    scope IN ('platform','tenant')
                    AND ((scope = 'platform' AND tenant_id IS NULL) OR (scope = 'tenant' AND tenant_id IS NOT NULL))
                    AND char_length(action_type) BETWEEN 1 AND 64 AND capability IN ('use','execution') AND (scope = 'platform' OR action_type <> '*')
                    AND version >= 1
                    AND previous_enabled <> new_enabled
                    AND char_length(btrim(reason)) BETWEEN 3 AND 500
                )
            SQL);

        // C2: الإدراج في الحالة الأساسية فقط.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_controls_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.version <> 0 OR NEW.enabled THEN
                    RAISE EXCEPTION 'ai_action_controls: a control is created in its baseline state and changes only through an audit event';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_control_baseline BEFORE INSERT ON ai_action_controls FOR EACH ROW EXECUTE FUNCTION ai_action_controls_guard_insert()');

        // C3: التحديث المباشر مرفوض ما لم يطابق حدثاً مُدرجاً بالنسخة التالية؛ الهوية مجمّدة.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_controls_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.id IS DISTINCT FROM OLD.id
                    OR NEW.scope IS DISTINCT FROM OLD.scope
                    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                    OR NEW.action_type IS DISTINCT FROM OLD.action_type
                    OR NEW.capability IS DISTINCT FROM OLD.capability
                    OR NEW.created_at IS DISTINCT FROM OLD.created_at
                    OR NEW.version <> OLD.version + 1
                    OR NOT EXISTS (
                        SELECT 1 FROM ai_action_control_events e
                         WHERE e.control_id = NEW.id AND e.version = NEW.version
                           AND e.previous_enabled = OLD.enabled AND e.new_enabled = NEW.enabled
                    )
                THEN
                    RAISE EXCEPTION 'ai_action_controls: state changes only through a matching audit event';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_control_update_guard BEFORE UPDATE ON ai_action_controls FOR EACH ROW EXECUTE FUNCTION ai_action_controls_guard_update()');

        // C4 / E2: المنصة دائماً مرفوض؛ المستأجر ما دام صفه موجوداً (حذف المستأجر المتسلسل يمرّ).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_controls_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'ai_action_controls: rollout controls cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_control_no_delete BEFORE DELETE ON ai_action_controls FOR EACH ROW EXECUTE FUNCTION ai_action_controls_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_control_events_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'ai_action_control_events: audit events are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_event_no_update BEFORE UPDATE ON ai_action_control_events FOR EACH ROW EXECUTE FUNCTION ai_action_control_events_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_control_events_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'ai_action_control_events: audit events cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_event_no_delete BEFORE DELETE ON ai_action_control_events FOR EACH ROW EXECUTE FUNCTION ai_action_control_events_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_control_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'ai action control tables cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_control_no_truncate BEFORE TRUNCATE ON ai_action_controls FOR EACH STATEMENT EXECUTE FUNCTION ai_action_control_guard_truncate()');
        DB::unprepared('CREATE TRIGGER ai_action_control_event_no_truncate BEFORE TRUNCATE ON ai_action_control_events FOR EACH STATEMENT EXECUTE FUNCTION ai_action_control_guard_truncate()');

        // C3: الحدث يطبّق حالته على الضابط ذرّياً بمقارنة-وتبديل على (الهوية، النسخة السابقة، الحالة السابقة).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION ai_action_control_events_apply() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                UPDATE ai_action_controls
                   SET enabled = NEW.new_enabled, version = NEW.version, updated_at = CURRENT_TIMESTAMP
                 WHERE id = NEW.control_id AND scope = NEW.scope AND tenant_id IS NOT DISTINCT FROM NEW.tenant_id
                   AND action_type = NEW.action_type AND capability = NEW.capability AND version = NEW.version - 1 AND enabled = NEW.previous_enabled;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'ai_action_control_events: the event does not match the current control state and version';
                END IF;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER ai_action_control_event_apply AFTER INSERT ON ai_action_control_events FOR EACH ROW EXECUTE FUNCTION ai_action_control_events_apply()');
    }

    private function createSqliteGuards(): void
    {
        // C1 / E4 (SQLite لا يضيف CHECK بعد الإنشاء): مُشغّلا إدراج بالشروط نفسها؛ NULL يُعامَل فشلاً.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_control_shape BEFORE INSERT ON ai_action_controls
            WHEN COALESCE(NOT (
                NEW.scope IN ('platform','tenant')
                AND ((NEW.scope = 'platform' AND NEW.tenant_id IS NULL) OR (NEW.scope = 'tenant' AND NEW.tenant_id IS NOT NULL))
                AND length(NEW.action_type) BETWEEN 1 AND 64 AND NEW.capability IN ('use','execution') AND (NEW.scope = 'platform' OR NEW.action_type <> '*')
                AND NEW.version >= 0
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_controls: invalid control shape');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_event_shape BEFORE INSERT ON ai_action_control_events
            WHEN COALESCE(NOT (
                NEW.scope IN ('platform','tenant')
                AND ((NEW.scope = 'platform' AND NEW.tenant_id IS NULL) OR (NEW.scope = 'tenant' AND NEW.tenant_id IS NOT NULL))
                AND length(NEW.action_type) BETWEEN 1 AND 64 AND NEW.capability IN ('use','execution') AND (NEW.scope = 'platform' OR NEW.action_type <> '*')
                AND NEW.version >= 1
                AND NEW.previous_enabled <> NEW.new_enabled
                AND length(trim(NEW.reason)) BETWEEN 3 AND 500
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_control_events: invalid event shape');
            END
            SQL);

        // C2
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_control_baseline BEFORE INSERT ON ai_action_controls
            WHEN NEW.version <> 0 OR NEW.enabled <> 0
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_controls: a control is created in its baseline state and changes only through an audit event');
            END
            SQL);

        // C3
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_control_update_guard BEFORE UPDATE ON ai_action_controls
            WHEN NEW.id IS NOT OLD.id OR NEW.scope IS NOT OLD.scope OR NEW.tenant_id IS NOT OLD.tenant_id
              OR NEW.action_type IS NOT OLD.action_type OR NEW.capability IS NOT OLD.capability OR NEW.created_at IS NOT OLD.created_at
              OR NEW.version <> OLD.version + 1
              OR NOT EXISTS (
                  SELECT 1 FROM ai_action_control_events e
                   WHERE e.control_id = NEW.id AND e.version = NEW.version
                     AND e.previous_enabled = OLD.enabled AND e.new_enabled = NEW.enabled
              )
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_controls: state changes only through a matching audit event');
            END
            SQL);

        // C4 / E2
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_control_no_delete BEFORE DELETE ON ai_action_controls
            WHEN OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_controls: rollout controls cannot be deleted');
            END
            SQL);
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_event_no_delete BEFORE DELETE ON ai_action_control_events
            WHEN OLD.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_control_events: audit events cannot be deleted');
            END
            SQL);

        // E1
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_event_no_update BEFORE UPDATE ON ai_action_control_events
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_control_events: audit events are immutable');
            END
            SQL);

        // C3: الحدث يطبّق حالته ذرّياً بمقارنة-وتبديل.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER ai_action_control_event_apply AFTER INSERT ON ai_action_control_events
            BEGIN
                SELECT RAISE(ABORT, 'ai_action_control_events: the event does not match the current control state and version')
                 WHERE NOT EXISTS (
                     SELECT 1 FROM ai_action_controls
                      WHERE id = NEW.control_id AND scope = NEW.scope AND tenant_id IS NEW.tenant_id
                        AND action_type = NEW.action_type AND capability = NEW.capability AND version = NEW.version - 1 AND enabled = NEW.previous_enabled
                 );
                UPDATE ai_action_controls
                   SET enabled = NEW.new_enabled, version = NEW.version, updated_at = CURRENT_TIMESTAMP
                 WHERE id = NEW.control_id;
            END
            SQL);
    }
};

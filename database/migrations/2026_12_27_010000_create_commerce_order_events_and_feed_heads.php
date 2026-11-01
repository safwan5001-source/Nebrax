<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * COPS-H1-1 (ADR-29 §2.4) — سجل أحداث طلب المتجر (append-only) ورأس تسلسل التغذية لكل مستأجر.
 *
 *  - `commerce_order_feed_heads`  صف **قفل** ثابت لكل مستأجر (لا يُحدَّث أبداً): الكاتب يقفله `FOR UPDATE` آخراً ثم يحسب
 *                                 `feed_seq = max(feed_seq) + 1` من الفهرس الفريد تحت القفل.
 *  - `commerce_order_events`      حدث ثابت لكل انتقال معتمد، مرقَّم `feed_seq` بلا فجوات بترتيب الالتزام لكل مستأجر.
 *
 * ═══ لماذا الرأس قفلٌ لا عدّاد (قياس R-2) ═══
 *  النسخة الأولى خزّنت `last_seq` على الرأس وحدّثته في كل حدث؛ تحت 20 كاتباً متزامناً كان p95 انتظار القفل ≈125–150ms بذيل طويل لأن المنتظرين
 *  على صفٍّ يُعاد إصداره كل مرة يتبعون سلسلة التحديث ويعيدون القفل (READ COMMITTED). صف قفل لا يُحدَّث أزال الذيل (انظر تقرير H1-1).
 *
 * ═══ لماذا لا يلمس الكاتب صف `tenants` أبداً (شرط عدم الجمود) ═══
 *  إدراج صف بمفتاح أجنبي إلى `tenants` يأخذ في PostgreSQL `FOR KEY SHARE` على صف المستأجر، بينما مِرساة الترقيم/الأستاذ تأخذ عليه
 *  `FOR UPDATE`. الحدث يُكتب **آخراً** في معاملات تمسك صفوف النية/الطلب/الحجز؛ لو احتاج قفلاً على `tenants` لتكوّنت حلقة مع إتمام
 *  Checkout (يمسك المِرساة ثم ينتظر صفوف الحجز/المنتجات). لذلك:
 *   • `commerce_order_events.tenant_id` → `commerce_order_feed_heads.tenant_id` (لا إلى `tenants`): فحص المفتاح الأجنبي يقع على صف الرأس
 *     الذي يمسكه الكاتب `FOR UPDATE` أصلاً.
 *   • صف الرأس يُنشأ **مع المستأجر** (مُشغّل `AFTER INSERT` على `tenants`) ويُزرع هنا للمستأجرين القائمين، فلا يُدرجه الكاتب في المسار المعتاد.
 *   • لا مفتاح أجنبي من الحدث إلى `commerce_orders`: مُشغّل الإدراج يتحقق أن الطلب موجود وللمستأجر نفسه (قراءة بلا قفل)، ويبقى سجل التدقيق
 *     الثابت قائماً إن حُذف طلب بـSQL خام (الطلب المؤكَّد/الملغى محميّ من الحذف أصلاً بالنموذج/المُشغّل).
 *
 * ═══ ما تفرضه القاعدة (المحرّكان) ═══
 *  E1  UPDATE على الحدث مرفوض دائماً.
 *  E2  DELETE على الحدث/الرأس مرفوض ما دام صف المستأجر موجوداً (حذف المستأجر المتسلسل يمرّ: الرأس ثم أحداثه).
 *  E3  TRUNCATE مرفوض (PostgreSQL).
 *  E4  إدراج حدث يُقبل فقط بـ`feed_seq = max(feed_seq للمستأجر) + 1` (والتفرّد يمنع التكرار) — لا فجوة ولا قفزة.
 *  E5  صف الرأس لا يُحدَّث إطلاقاً (قفل خالص).
 *  E6  الحدث يُشير إلى طلب موجود للمستأجر نفسه (PostgreSQL في القاعدة؛ SQLite في الكاتب — انظر sqliteGuards)؛ النوع والفاعل من قائمة
 *      مغلقة (`actor_id` إلزامي لـuser/customer وممنوع لـguest/system) في المحرّكين.
 *
 * أسماء المُشغّلات والدوال بالبادئة `cofeed_` عمداً: اختبارات قائمة تحصي مُشغّلات بنمط `comm_%` (و`_` في LIKE حرف بدل).
 *
 * ═══ التراجع ═══ `down()` يرفض متى وُجد أي حدث (لا علم تجاوز) — نمط سلسلة ZATCA.
 */
return new class extends Migration
{
    private const HEADS = 'commerce_order_feed_heads';

    private const EVENTS = 'commerce_order_events';

    /** القائمة المغلقة لأنواع H1-1. كل شريحة لاحقة تضيف أنواعها بهجرة صريحة (ADR-29 §2.4). */
    private const TYPES = ['order.placed', 'order.cancelled', 'payment.paid', 'payment.collected'];

    private const ACTORS = ['user', 'customer', 'guest', 'system'];

    public function up(): void
    {
        Schema::create(self::HEADS, function (Blueprint $table) {
            $table->uuid('tenant_id')->primary();
            $table->timestamp('created_at')->nullable();

            $table->foreign('tenant_id', 'commerce_feed_head_tenant_fk')->references('id')->on('tenants')->cascadeOnDelete();
        });

        Schema::create(self::EVENTS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('commerce_order_id');
            $table->unsignedBigInteger('feed_seq');
            $table->string('type', 48);
            $table->string('actor_type', 16);
            $table->uuid('actor_id')->nullable();
            $table->json('data')->nullable();
            $table->timestamp('occurred_at');
            $table->timestamp('created_at')->nullable();   // لا updated_at: الحدث لا يتغيّر

            $table->foreign('tenant_id', 'commerce_event_head_fk')->references('tenant_id')->on(self::HEADS)->cascadeOnDelete();
            $table->unique(['tenant_id', 'feed_seq'], 'commerce_event_tenant_seq_unique');
            $table->index(['tenant_id', 'commerce_order_id', 'feed_seq'], 'commerce_event_order_timeline_idx');
        });

        // صف قفل لكل مستأجر قائم (ليس Backfill لبيانات عمل).
        DB::statement('INSERT INTO '.self::HEADS.' (tenant_id, created_at) SELECT id, CURRENT_TIMESTAMP FROM tenants');

        DB::connection()->getDriverName() === 'pgsql' ? $this->postgresGuards() : $this->sqliteGuards();
    }

    public function down(): void
    {
        if (Schema::hasTable(self::EVENTS) && DB::table(self::EVENTS)->exists()) {
            throw new RuntimeException(
                'Rollback refused: commerce_order_events contains rows. The order audit log is append-only and is never dropped by rollback; '
                .'use a forward-only migration instead.'
            );
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP TRIGGER IF EXISTS cofeed_head_on_tenant ON tenants');
            Schema::dropIfExists(self::EVENTS);
            Schema::dropIfExists(self::HEADS);
            foreach ([
                'cofeed_events_guard_update', 'cofeed_events_guard_delete', 'cofeed_events_guard_insert',
                'cofeed_events_contiguous', 'cofeed_heads_guard_update',
                'cofeed_heads_guard_delete', 'cofeed_guard_truncate', 'cofeed_head_create_for_tenant',
            ] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }

            return;
        }

        DB::statement('DROP TRIGGER IF EXISTS cofeed_head_on_tenant');
        Schema::dropIfExists(self::EVENTS);
        Schema::dropIfExists(self::HEADS);
    }

    private function typeList(): string
    {
        return implode(',', array_map(fn (string $t) => "'{$t}'", self::TYPES));
    }

    private function actorList(): string
    {
        return implode(',', array_map(fn (string $a) => "'{$a}'", self::ACTORS));
    }

    private function postgresGuards(): void
    {
        $types = $this->typeList();
        $actors = $this->actorList();

        DB::statement('ALTER TABLE '.self::EVENTS." ADD CONSTRAINT commerce_event_shape_chk CHECK (
            feed_seq > 0
            AND type IN ({$types})
            AND actor_type IN ({$actors})
            AND ((actor_type IN ('user','customer') AND actor_id IS NOT NULL) OR (actor_type IN ('guest','system') AND actor_id IS NULL))
        )");

        // رسائل ثابتة النص (لا استيفاء لقيم الصف).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_events_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'commerce_order_events: order events are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_event_no_update BEFORE UPDATE ON commerce_order_events FOR EACH ROW EXECUTE FUNCTION cofeed_events_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_events_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'commerce_order_events: order events cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_event_no_delete BEFORE DELETE ON commerce_order_events FOR EACH ROW EXECUTE FUNCTION cofeed_events_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_heads_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'commerce_order_feed_heads: feed heads cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_head_no_delete BEFORE DELETE ON commerce_order_feed_heads FOR EACH ROW EXECUTE FUNCTION cofeed_heads_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'commerce order feed tables cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_event_no_truncate BEFORE TRUNCATE ON commerce_order_events FOR EACH STATEMENT EXECUTE FUNCTION cofeed_guard_truncate()');
        DB::unprepared('CREATE TRIGGER cofeed_head_no_truncate BEFORE TRUNCATE ON commerce_order_feed_heads FOR EACH STATEMENT EXECUTE FUNCTION cofeed_guard_truncate()');

        // E6: الطلب موجود وللمستأجر نفسه (قراءة MVCC بلا قفل).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_events_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF (SELECT tenant_id FROM commerce_orders WHERE id = NEW.commerce_order_id) IS DISTINCT FROM NEW.tenant_id THEN
                    RAISE EXCEPTION 'commerce_order_events: the order does not exist in the event tenant';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_event_order_tenant BEFORE INSERT ON commerce_order_events FOR EACH ROW EXECUTE FUNCTION cofeed_events_guard_insert()');

        // E4: التسلسل متصل — max+1 فقط (التفرّد يمنع التكرار؛ قراءة الفهرس بلا قفل، والكاتب يمسك صف الرأس).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_events_contiguous() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.feed_seq <> COALESCE((SELECT max(feed_seq) FROM commerce_order_events WHERE tenant_id = NEW.tenant_id), 0) + 1 THEN
                    RAISE EXCEPTION 'commerce_order_events: the event sequence must be exactly the tenant maximum plus one';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_event_contiguous BEFORE INSERT ON commerce_order_events FOR EACH ROW EXECUTE FUNCTION cofeed_events_contiguous()');

        // E5: صف القفل لا يُحدَّث.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_heads_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'commerce_order_feed_heads: feed heads are immutable lock rows';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_head_guard BEFORE UPDATE ON commerce_order_feed_heads FOR EACH ROW EXECUTE FUNCTION cofeed_heads_guard_update()');

        // رأس لكل مستأجر من ولادته (ON CONFLICT: إدراج يدوي سابق للرأس لا يُفشل إنشاء المستأجر).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION cofeed_head_create_for_tenant() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                INSERT INTO commerce_order_feed_heads (tenant_id, created_at)
                VALUES (NEW.id, CURRENT_TIMESTAMP)
                ON CONFLICT (tenant_id) DO NOTHING;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER cofeed_head_on_tenant AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION cofeed_head_create_for_tenant()');
    }

    private function sqliteGuards(): void
    {
        $types = $this->typeList();
        $actors = $this->actorList();

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cofeed_event_no_update BEFORE UPDATE ON commerce_order_events
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_events: order events are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cofeed_event_no_delete BEFORE DELETE ON commerce_order_events
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_events: order events cannot be deleted');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cofeed_head_no_delete BEFORE DELETE ON commerce_order_feed_heads
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_feed_heads: feed heads cannot be deleted');
            END
            SQL);

        // بديل CHECK الشكل (SQLite لا يضيف CHECK بعد الإنشاء). NULL يُعامَل فشلاً.
        DB::unprepared(<<<SQL
            CREATE TRIGGER cofeed_event_shape BEFORE INSERT ON commerce_order_events
            WHEN COALESCE(NOT (
                NEW.feed_seq > 0
                AND NEW.type IN ({$types})
                AND NEW.actor_type IN ({$actors})
                AND ((NEW.actor_type IN ('user','customer') AND NEW.actor_id IS NOT NULL) OR (NEW.actor_type IN ('guest','system') AND NEW.actor_id IS NULL))
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_events: invalid event shape');
            END
            SQL);

        // E6 على SQLite في طبقة التطبيق فقط (`CommerceOrderEventRecorder` يأخذ المستأجر من الطلب نفسه): مُشغّل يذكر `commerce_orders` في جسمه
        // يكسر إعادة بناء SQLite لذلك الجدول (إسقاط ثم إعادة تسمية `__temp__…` — تفعلها هجرات قائمة واختبارات تراجعها) لأن SQLite يتحقق من أسماء
        // أجسام المُشغّلات عند إعادة التسمية. PostgreSQL (الإنتاج) يفرضه في القاعدة أعلاه ويعدّل الجداول في مكانها.

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cofeed_event_contiguous BEFORE INSERT ON commerce_order_events
            WHEN NEW.feed_seq IS NOT COALESCE((SELECT MAX(feed_seq) FROM commerce_order_events WHERE tenant_id = NEW.tenant_id), 0) + 1
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_events: the event sequence must be exactly the tenant maximum plus one');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cofeed_head_guard BEFORE UPDATE ON commerce_order_feed_heads
            BEGIN
                SELECT RAISE(ABORT, 'commerce_order_feed_heads: feed heads are immutable lock rows');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER cofeed_head_on_tenant AFTER INSERT ON tenants
            BEGIN
                INSERT OR IGNORE INTO commerce_order_feed_heads (tenant_id, created_at)
                VALUES (NEW.id, CURRENT_TIMESTAMP);
            END
            SQL);
    }
};

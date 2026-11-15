<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * TANKER-PR5 — مرفقات سندات تعبئة الصهاريج: جدول إضافي واحد، لا تعديل لأي جدول قائم ولا Backfill.
 *
 * **دليل فقط — لا أثر مالي أو مخزني:** لا يغيّر سند التعبئة (`fuel_tanker_fills`) ولا `inventory_status`، ولا يدخل في أي قيد أو حركة مخزون.
 *
 * - المرفق مربوط بسند التعبئة (`fuel_tanker_fill_id`) فيُعرَض دائماً مع رقمه الإلكتروني FTF ورقم السند الورقي (من السند نفسه).
 * - **السجل التاريخي لا يُفقد:** الصف لا يُحذف أبداً (مُشغّل قاعدة بيانات). الإزالة والاستبدال انتقالان من `active` إلى `removed`/`replaced` مع منفّذ ووقت وسبب،
 *   وبقية أعمدة هوية الملف (القرص، المسار، الاسم، النوع، الحجم، البصمة، الرافع، وقت الرفع) **ثابتة**. الملف الفعلي يبقى في التخزين الخاص ولا يُمحى.
 * - **idempotency بالمحتوى:** فهرس فريد جزئي `(fuel_tanker_fill_id, sha256)` على المرفقات `active` فقط: إعادة طلب رفع (بعد انقطاع الرد) لا تُنتج نسخة ثانية،
 *   ويمكن إعادة رفع محتوى سبقت إزالته.
 * - المفتاح الأجنبي للسند `NO ACTION`: يمنع حذف سند له مرفقات ويسمح بحذف المستأجر كاملاً (كبقية جداول الوقود).
 *
 * الميزة خلف بوابتَي `tanker_management_enabled` و`tanker_fills_enabled` (مغلقتان افتراضياً في الكود). التراجع يرفض متى وُجد أي صف.
 */
return new class extends Migration
{
    private const TABLE = 'fuel_tanker_fill_attachments';

    /** أعمدة هوية الملف: لا تتغيّر أبداً بعد الإنشاء. */
    private const IMMUTABLE = [
        'id', 'tenant_id', 'branch_id', 'fuel_tanker_fill_id', 'disk', 'path', 'original_name', 'mime_type', 'size', 'sha256',
        'uploaded_by', 'uploaded_at', 'replaces_attachment_id', 'created_at',
    ];

    public function up(): void
    {
        Schema::create(self::TABLE, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('branch_id')->constrained();
            $table->foreignUuid('fuel_tanker_fill_id')->constrained('fuel_tanker_fills');

            $table->string('disk', 16);
            $table->string('path', 512);
            $table->string('original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedBigInteger('size');
            $table->char('sha256', 64);

            $table->string('status', 16)->default('active');
            $table->foreignUuid('uploaded_by')->constrained('users');
            $table->timestamp('uploaded_at');
            $table->uuid('replaces_attachment_id')->nullable();
            $table->uuid('replaced_by_attachment_id')->nullable();
            $table->foreignUuid('removed_by')->nullable()->constrained('users');
            $table->timestamp('removed_at')->nullable();
            $table->text('removal_reason')->nullable();
            $table->timestamps();

            $table->index(['tenant_id', 'fuel_tanker_fill_id', 'status'], 'fuel_tanker_fill_attachment_fill_idx');
        });
        // المفاتيح الذاتية بعد إنشاء الجدول: PostgreSQL يرفض مرجعاً إلى مفتاح أساسي لم يُنشأ بعد داخل عبارة الإنشاء نفسها.
        Schema::table(self::TABLE, function (Blueprint $table) {
            $table->foreign('replaces_attachment_id')->references('id')->on(self::TABLE);
            $table->foreign('replaced_by_attachment_id')->references('id')->on(self::TABLE);
        });

        // فهرس فريد جزئي: محتوى واحد نشط لكل سند (PostgreSQL وSQLite كلاهما يدعمان الفهارس الجزئية).
        DB::statement("CREATE UNIQUE INDEX fuel_tanker_fill_attachment_sha_unique ON fuel_tanker_fill_attachments (fuel_tanker_fill_id, sha256) WHERE status = 'active'");

        $driver = DB::connection()->getDriverName();
        if ($driver === 'pgsql') {
            $this->postgresGuards();
        } elseif ($driver === 'sqlite') {
            $this->sqliteGuards();
        }
    }

    public function down(): void
    {
        if (Schema::hasTable(self::TABLE) && DB::table(self::TABLE)->exists()) {
            throw new RuntimeException('Rollback refused: fuel_tanker_fill_attachments contains attachment records.');
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_attachments_guard_update() CASCADE');
            DB::statement('DROP FUNCTION IF EXISTS fuel_tanker_fill_attachments_guard_delete() CASCADE');
        }
        Schema::dropIfExists(self::TABLE);
    }

    private function postgresGuards(): void
    {
        DB::statement("ALTER TABLE fuel_tanker_fill_attachments
            ADD CONSTRAINT fuel_tanker_fill_attachment_shape CHECK (
                status IN ('active', 'removed', 'replaced')
                AND size > 0
                AND (status <> 'removed' OR (removed_by IS NOT NULL AND removed_at IS NOT NULL AND removal_reason IS NOT NULL))
                AND (status <> 'replaced' OR (removed_by IS NOT NULL AND removed_at IS NOT NULL AND replaced_by_attachment_id IS NOT NULL))
                AND (status <> 'active' OR (removed_by IS NULL AND removed_at IS NULL AND removal_reason IS NULL AND replaced_by_attachment_id IS NULL))
            )");

        $immutable = implode("\n                    OR ", array_map(fn (string $c) => "NEW.{$c} IS DISTINCT FROM OLD.{$c}", self::IMMUTABLE));
        DB::unprepared(<<<SQL
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_attachments_guard_update() RETURNS trigger LANGUAGE plpgsql AS \$fn\$
            BEGIN
                IF {$immutable} THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_attachments: file identity fields are immutable';
                END IF;
                IF OLD.status <> 'active' AND (
                    NEW.status IS DISTINCT FROM OLD.status OR NEW.removed_by IS DISTINCT FROM OLD.removed_by
                    OR NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.removal_reason IS DISTINCT FROM OLD.removal_reason
                    OR NEW.replaced_by_attachment_id IS DISTINCT FROM OLD.replaced_by_attachment_id
                ) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_attachments: a removed or replaced attachment cannot change';
                END IF;
                RETURN NEW;
            END
            \$fn\$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_attachment_no_direct_update BEFORE UPDATE ON fuel_tanker_fill_attachments FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_attachments_guard_update()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION fuel_tanker_fill_attachments_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'fuel_tanker_fill_attachments: attachments cannot be deleted (history is preserved)';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER fuel_tanker_fill_attachment_no_delete BEFORE DELETE ON fuel_tanker_fill_attachments FOR EACH ROW EXECUTE FUNCTION fuel_tanker_fill_attachments_guard_delete()');
    }

    private function sqliteGuards(): void
    {
        $immutable = implode(' OR ', array_map(fn (string $c) => "OLD.{$c} IS NOT NEW.{$c}", self::IMMUTABLE));

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_attachment_shape BEFORE INSERT ON fuel_tanker_fill_attachments
            WHEN NEW.status NOT IN ('active', 'removed', 'replaced') OR NEW.size <= 0 OR NEW.status <> 'active'
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_attachments: invalid attachment shape');
            END
            SQL);

        DB::unprepared(<<<SQL
            CREATE TRIGGER fuel_tanker_fill_attachment_no_direct_update BEFORE UPDATE ON fuel_tanker_fill_attachments
            WHEN {$immutable}
                OR NEW.status NOT IN ('active', 'removed', 'replaced')
                OR (OLD.status <> 'active' AND (
                    NEW.status IS NOT OLD.status OR NEW.removed_by IS NOT OLD.removed_by OR NEW.removed_at IS NOT OLD.removed_at
                    OR NEW.removal_reason IS NOT OLD.removal_reason OR NEW.replaced_by_attachment_id IS NOT OLD.replaced_by_attachment_id))
                OR (NEW.status = 'removed' AND (NEW.removed_by IS NULL OR NEW.removed_at IS NULL OR NEW.removal_reason IS NULL))
                OR (NEW.status = 'replaced' AND (NEW.removed_by IS NULL OR NEW.removed_at IS NULL OR NEW.replaced_by_attachment_id IS NULL))
                OR (NEW.status = 'active' AND (NEW.removed_by IS NOT NULL OR NEW.removed_at IS NOT NULL OR NEW.removal_reason IS NOT NULL OR NEW.replaced_by_attachment_id IS NOT NULL))
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_attachments: file identity fields are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fuel_tanker_fill_attachment_no_delete BEFORE DELETE ON fuel_tanker_fill_attachments
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'fuel_tanker_fill_attachments: attachments cannot be deleted (history is preserved)');
            END
            SQL);
    }
};

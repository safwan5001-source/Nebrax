<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * REM-18b-1 — أساس سلسلة ZATCA المشتركة (ICV/PIH) للفواتير والإشعارات الدائنة: **مخطط فقط**.
 *
 * جدولان إضافيان بحتان لا يقرؤهما ولا يكتبهما أي مسار قائم:
 *
 *  - `zatca_chains`         رأس سلسلة واحد لكل (مستأجر، مفتاح سلسلة): آخر ICV مُصدَر وبذرته.
 *  - `zatca_chain_entries`  مدخل واحد غير قابل للتعديل لكل مستند إلكتروني صدر (فاتورة 388 أو إشعار دائن 381).
 *
 * **لا Backfill** ولا مَسّ بأي صف في `invoices` أو `credit_notes`؛ لا مخصِّص ICV (REM-18b-2)؛ لا سياج F1/F2 (REM-18b-2/3).
 * المرجع: `docs/audits/horizon/REM-18b-SHARED-CHAIN-DESIGN.md` (§3–§4، §7، §12، §13).
 *
 * ═══ ما تفرضه القاعدة لا الكود وحده (مُشغّلات بالمحرّكين) ═══
 *  T1  UPDATE على `zatca_chain_entries` مرفوض دائماً.
 *  T2  DELETE على `zatca_chain_entries` مرفوض ما دام صف المستأجر المالك موجوداً (حذف المستأجر المتسلسل يمرّ — انظر أدناه).
 *  T3  TRUNCATE على الجدولين مرفوض (PostgreSQL فقط؛ لا TRUNCATE في SQLite).
 *  T4  إدراج مدخل يُقدّم رأس السلسلة ذرّياً (icv = last_icv + 1 وإلا ترفض القاعدة): لا قفزات ولا تكرار ولا مدخل لسلسلة مستأجر آخر.
 *  T5  رأس السلسلة لا يتغيّر إلا بخطوة +1 تقابل مدخلاً موجوداً؛ هويته مجمّدة.
 *  T6  إنشاء الرأس لا يقبل إلا بذرة = أكبر `invoices.zatca_icv` للمستأجر (أو 0) ومفتاحاً `tenant` — لا بذرة مختلقة.
 *  T7  DELETE على `zatca_chains` بقاعدة T2 نفسها.
 *  T8  مدخل يُشير إلى مستند مستأجر آخر مرفوض (عزل المستأجر في القاعدة).
 *  + قيود التفرّد (مفتاح السلسلة، ICV لكل سلسلة، مدخل واحد لكل فاتورة/إشعار، UUID لكل مستأجر) وCHECK نوع المستند
 *    (PostgreSQL CHECK؛ SQLite: مُشغّل إدراج بالشروط نفسها لأن SQLite لا يضيف CHECK بعد الإنشاء — نمط الاتصالات).
 *
 * ═══ سياسة الحذف (قرار O-R1، لا تغيير في سلوك حذف المستأجر) ═══
 *  `tenant_id` → `tenants` **CASCADE** كبقية الجداول (271 موضعاً). أما `invoice_id` / `credit_note_id` / `chain_id` فـ**RESTRICT**:
 *  لا يُحذف مستند له مدخل منفرداً، ولا رأس سلسلة له مداخل. حذف المستأجر النهائي يبقى كما هو اليوم (يحذف فواتيره وإشعاراته ومداخله معاً —
 *  مُثبَت بالاختبار على المحرّكين؛ وعلى PostgreSQL أيضاً بإشعار يشير إلى فاتورته — SQLite يفشل بهذا الشكل قبل المخطط أيضاً)،
 *  وهو **خطر احتفاظ غير محسوم** يُعالَج في REM-36 (احتفاظ ≥ 6 سنوات، IR المادة 66(1)) — لا يُغيَّر هنا.
 *
 * ═══ التراجع ═══
 *  `down()` يرفض الحذف متى وُجد أي صف في الجدولين، في كل البيئات وبلا علم تجاوز (نمط الاتصالات)؛ ومتى أُفرغا فلا خسارة.
 *
 * `previous_hash` / `hash` بطول 255 (كأعمدة `invoices`): PIH هو Base64 لنصّ SHA-256 الست عشري (88 حرفاً) لا 64 — تصحيح لما ورد في المسودة.
 */
return new class extends Migration
{
    private const CHAINS = 'zatca_chains';

    private const ENTRIES = 'zatca_chain_entries';

    public function up(): void
    {
        Schema::create(self::CHAINS, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('tenant_id')->constrained('tenants')->cascadeOnDelete();
            // `tenant` وحده اليوم (T6)؛ التقسيم بالبيئة/EGS قرار REM-25 بهجرته الخاصة.
            $table->string('chain_key', 64);
            $table->unsignedBigInteger('last_icv')->default(0);
            // آخر ICV قديم وقت إنشاء الرأس (max(invoices.zatca_icv) أو 0): حدّ بين السجل القديم والمداخل الجديدة.
            $table->unsignedBigInteger('seed_icv')->default(0);
            // توثيق فقط عند الإنشاء — لا يُستدلّ منهما على شيء: عدد الفواتير القديمة المرقّمة، وعدد المرحَّلة بهاش بلا ICV.
            $table->unsignedInteger('seed_legacy_count')->nullable();
            $table->unsignedInteger('seed_excluded_null_icv')->nullable();
            $table->timestamp('seeded_at')->nullable();
            $table->timestamps();

            $table->unique(['tenant_id', 'chain_key'], 'zatca_chain_tenant_key_unique');
            // هدف FK المركّبة من المداخل: لا مدخل يُشير إلى سلسلة مستأجر آخر.
            $table->unique(['tenant_id', 'id'], 'zatca_chain_tenant_id_unique');
        });

        Schema::create(self::ENTRIES, function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->uuid('tenant_id');
            $table->uuid('chain_id');
            $table->unsignedBigInteger('icv');
            $table->string('document_type', 20);          // invoice | credit_note
            $table->foreignUuid('invoice_id')->nullable()->constrained('invoices')->restrictOnDelete();
            $table->foreignUuid('credit_note_id')->nullable()->constrained('credit_notes')->restrictOnDelete();
            $table->char('type_code', 3);                 // 388 | 381
            $table->string('subtype', 20);                // standard | simplified (نسخ من المصدر، لا استنتاج)
            $table->uuid('zatca_uuid');
            $table->string('previous_hash');
            $table->string('hash');
            $table->boolean('signed')->default(false);
            $table->timestamp('issued_at');
            $table->timestamp('created_at')->nullable();   // لا updated_at: المدخل لا يتغيّر

            $table->foreign('tenant_id', 'zatca_entry_tenant_fk')->references('id')->on('tenants')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'chain_id'], 'zatca_entry_chain_fk')
                ->references(['tenant_id', 'id'])->on(self::CHAINS)->restrictOnDelete();
            $table->unique(['chain_id', 'icv'], 'zatca_entry_chain_icv_unique');
            $table->unique('invoice_id', 'zatca_entry_invoice_unique');
            $table->unique('credit_note_id', 'zatca_entry_credit_note_unique');
            $table->unique(['tenant_id', 'zatca_uuid'], 'zatca_entry_uuid_unique');
            $table->index(['tenant_id', 'document_type'], 'zatca_entry_tenant_type_idx');
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            $this->createPostgresGuards();
        } else {
            $this->createSqliteGuards();
        }
    }

    public function down(): void
    {
        // لا استثناء لأي بيئة ولا علم تجاوز: سجل السلسلة المأهول لا يُحذف بالتراجع. من يحتاج تراجعاً يُفرغ الجدولين
        // صراحةً (وذلك أصلاً ممنوع بمُشغّلات T2/T3 — أي لا تراجع بعد أول مستند إلكتروني: التغييرات إلى الأمام فقط).
        foreach ([self::ENTRIES, self::CHAINS] as $table) {
            if (Schema::hasTable($table) && DB::table($table)->exists()) {
                throw new RuntimeException(
                    'Rollback refused: zatca_chains / zatca_chain_entries contain rows. '
                    .'Issued ZATCA chain records are never dropped by rollback in any environment; use a forward-only migration instead.'
                );
            }
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            // المُشغّلات تسقط مع الجداول؛ تُسقط الدوال صراحةً.
            Schema::dropIfExists(self::ENTRIES);
            Schema::dropIfExists(self::CHAINS);
            foreach ([
                'zatca_chain_entries_guard_update', 'zatca_chain_entries_guard_delete', 'zatca_chain_entries_guard_insert',
                'zatca_chain_entries_advance_head', 'zatca_chains_guard_update', 'zatca_chains_guard_insert',
                'zatca_chains_guard_delete', 'zatca_chain_guard_truncate',
            ] as $function) {
                DB::statement("DROP FUNCTION IF EXISTS {$function}()");
            }

            return;
        }

        // SQLite: إسقاط الجدول يُسقط مُشغّلاته.
        Schema::dropIfExists(self::ENTRIES);
        Schema::dropIfExists(self::CHAINS);
    }

    private function createPostgresGuards(): void
    {
        DB::statement(<<<'SQL'
            ALTER TABLE zatca_chains
                ADD CONSTRAINT zatca_chain_shape_chk CHECK (
                    chain_key <> '' AND last_icv >= seed_icv
                )
            SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE zatca_chain_entries
                ADD CONSTRAINT zatca_entry_shape_chk CHECK (
                    icv > 0
                    AND previous_hash <> '' AND hash <> ''
                    AND subtype IN ('standard','simplified')
                    AND (
                        (document_type = 'invoice' AND invoice_id IS NOT NULL AND credit_note_id IS NULL AND type_code = '388')
                        OR (document_type = 'credit_note' AND credit_note_id IS NOT NULL AND invoice_id IS NULL AND type_code = '381')
                    )
                )
            SQL);

        // رسائل الأخطاء ثابتة النص عمداً: لا استيفاء لقيم OLD/NEW. رمز الاستثناء الافتراضي P0001 لا يلتبس بـ23505/23503.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chain_entries_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'zatca_chain_entries: issued chain entries are immutable';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_entry_no_update BEFORE UPDATE ON zatca_chain_entries FOR EACH ROW EXECUTE FUNCTION zatca_chain_entries_guard_update()');

        // المنع ما دام المستأجر موجوداً (يشمل المحذوف حذفاً ناعماً)؛ حذف المستأجر المتسلسل يُنفَّذ بعد زوال صفه فيمرّ.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chain_entries_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'zatca_chain_entries: issued chain entries cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_entry_no_delete BEFORE DELETE ON zatca_chain_entries FOR EACH ROW EXECUTE FUNCTION zatca_chain_entries_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chains_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
                    RAISE EXCEPTION 'zatca_chains: chain heads cannot be deleted';
                END IF;
                RETURN OLD;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_chain_no_delete BEFORE DELETE ON zatca_chains FOR EACH ROW EXECUTE FUNCTION zatca_chains_guard_delete()');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chain_guard_truncate() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                RAISE EXCEPTION 'zatca chain tables cannot be truncated';
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_entry_no_truncate BEFORE TRUNCATE ON zatca_chain_entries FOR EACH STATEMENT EXECUTE FUNCTION zatca_chain_guard_truncate()');
        DB::unprepared('CREATE TRIGGER zatca_chain_no_truncate BEFORE TRUNCATE ON zatca_chains FOR EACH STATEMENT EXECUTE FUNCTION zatca_chain_guard_truncate()');

        // T8: المستند من مستأجر المدخل نفسه.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chain_entries_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.invoice_id IS NOT NULL
                    AND (SELECT tenant_id FROM invoices WHERE id = NEW.invoice_id) IS DISTINCT FROM NEW.tenant_id THEN
                    RAISE EXCEPTION 'zatca_chain_entries: the invoice belongs to another tenant';
                END IF;
                IF NEW.credit_note_id IS NOT NULL
                    AND (SELECT tenant_id FROM credit_notes WHERE id = NEW.credit_note_id) IS DISTINCT FROM NEW.tenant_id THEN
                    RAISE EXCEPTION 'zatca_chain_entries: the credit note belongs to another tenant';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_entry_tenant_documents BEFORE INSERT ON zatca_chain_entries FOR EACH ROW EXECUTE FUNCTION zatca_chain_entries_guard_insert()');

        // T4: المدخل يُقدّم الرأس ذرّياً؛ لا قفزة ولا تكرار ولا سلسلة مستأجر آخر (الـFK المركّبة تمنعها أيضاً).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chain_entries_advance_head() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                UPDATE zatca_chains SET last_icv = NEW.icv, updated_at = CURRENT_TIMESTAMP
                 WHERE id = NEW.chain_id AND tenant_id = NEW.tenant_id AND last_icv = NEW.icv - 1;
                IF NOT FOUND THEN
                    RAISE EXCEPTION 'zatca_chain_entries: the entry ICV must be exactly the chain head plus one';
                END IF;
                RETURN NULL;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_entry_advance_head AFTER INSERT ON zatca_chain_entries FOR EACH ROW EXECUTE FUNCTION zatca_chain_entries_advance_head()');

        // T5: الرأس يتقدّم +1 مع مدخل مقابل فقط؛ الهوية مجمّدة.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chains_guard_update() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.id IS DISTINCT FROM OLD.id
                    OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
                    OR NEW.chain_key IS DISTINCT FROM OLD.chain_key
                    OR NEW.seed_icv IS DISTINCT FROM OLD.seed_icv
                    OR NEW.seed_legacy_count IS DISTINCT FROM OLD.seed_legacy_count
                    OR NEW.seed_excluded_null_icv IS DISTINCT FROM OLD.seed_excluded_null_icv
                    OR NEW.seeded_at IS DISTINCT FROM OLD.seeded_at
                    OR NEW.last_icv <> OLD.last_icv + 1
                    OR NOT EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.chain_id = NEW.id AND e.icv = NEW.last_icv)
                THEN
                    RAISE EXCEPTION 'zatca_chains: the head may only advance by one with a matching chain entry';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_chain_head_guard BEFORE UPDATE ON zatca_chains FOR EACH ROW EXECUTE FUNCTION zatca_chains_guard_update()');

        // T6: البذرة = القديم الفعلي للمستأجر (max يتجاهل NULL فلا يتأثر بفاتورة بلا ICV).
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION zatca_chains_guard_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
            BEGIN
                IF NEW.chain_key <> 'tenant'
                    OR NEW.last_icv <> NEW.seed_icv
                    OR NEW.seed_icv <> COALESCE((SELECT max(zatca_icv) FROM invoices WHERE tenant_id = NEW.tenant_id), 0)
                THEN
                    RAISE EXCEPTION 'zatca_chains: a chain head must be seeded at the legacy maximum ICV of its tenant';
                END IF;
                RETURN NEW;
            END
            $fn$
            SQL);
        DB::unprepared('CREATE TRIGGER zatca_chain_seed_guard BEFORE INSERT ON zatca_chains FOR EACH ROW EXECUTE FUNCTION zatca_chains_guard_insert()');
    }

    private function createSqliteGuards(): void
    {
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_entry_no_update BEFORE UPDATE ON zatca_chain_entries
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chain_entries: issued chain entries are immutable');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_entry_no_delete BEFORE DELETE ON zatca_chain_entries
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chain_entries: issued chain entries cannot be deleted');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_chain_no_delete BEFORE DELETE ON zatca_chains
            WHEN EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chains: chain heads cannot be deleted');
            END
            SQL);

        // بديل CHECK الشكل (SQLite لا يضيفه بعد الإنشاء): يطابق zatca_entry_shape_chk حرفياً. NULL يُعامَل فشلاً.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_entry_shape BEFORE INSERT ON zatca_chain_entries
            WHEN COALESCE(NOT (
                NEW.icv > 0
                AND NEW.previous_hash <> '' AND NEW.hash <> ''
                AND NEW.subtype IN ('standard','simplified')
                AND (
                    (NEW.document_type = 'invoice' AND NEW.invoice_id IS NOT NULL AND NEW.credit_note_id IS NULL AND NEW.type_code = '388')
                    OR (NEW.document_type = 'credit_note' AND NEW.credit_note_id IS NOT NULL AND NEW.invoice_id IS NULL AND NEW.type_code = '381')
                )
            ), 1)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chain_entries: invalid entry shape');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_entry_tenant_documents BEFORE INSERT ON zatca_chain_entries
            WHEN (NEW.invoice_id IS NOT NULL
                  AND (SELECT tenant_id FROM invoices WHERE id = NEW.invoice_id) IS NOT NEW.tenant_id)
              OR (NEW.credit_note_id IS NOT NULL
                  AND (SELECT tenant_id FROM credit_notes WHERE id = NEW.credit_note_id) IS NOT NEW.tenant_id)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chain_entries: the document belongs to another tenant');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_entry_advance_head AFTER INSERT ON zatca_chain_entries
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chain_entries: the entry ICV must be exactly the chain head plus one')
                 WHERE (SELECT last_icv FROM zatca_chains WHERE id = NEW.chain_id AND tenant_id = NEW.tenant_id) IS NOT NEW.icv - 1;
                UPDATE zatca_chains SET last_icv = NEW.icv, updated_at = CURRENT_TIMESTAMP WHERE id = NEW.chain_id;
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_chain_head_guard BEFORE UPDATE ON zatca_chains
            WHEN NEW.id IS NOT OLD.id OR NEW.tenant_id IS NOT OLD.tenant_id OR NEW.chain_key IS NOT OLD.chain_key
              OR NEW.seed_icv IS NOT OLD.seed_icv OR NEW.seed_legacy_count IS NOT OLD.seed_legacy_count
              OR NEW.seed_excluded_null_icv IS NOT OLD.seed_excluded_null_icv OR NEW.seeded_at IS NOT OLD.seeded_at
              OR NEW.last_icv <> OLD.last_icv + 1
              OR NOT EXISTS (SELECT 1 FROM zatca_chain_entries e WHERE e.chain_id = NEW.id AND e.icv = NEW.last_icv)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chains: the head may only advance by one with a matching chain entry');
            END
            SQL);

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER zatca_chain_seed_guard BEFORE INSERT ON zatca_chains
            WHEN NEW.chain_key <> 'tenant'
              OR NEW.last_icv <> NEW.seed_icv
              OR NEW.seed_icv <> COALESCE((SELECT MAX(zatca_icv) FROM invoices WHERE tenant_id = NEW.tenant_id), 0)
            BEGIN
                SELECT RAISE(ABORT, 'zatca_chains: a chain head must be seeded at the legacy maximum ICV of its tenant');
            END
            SQL);
    }
};

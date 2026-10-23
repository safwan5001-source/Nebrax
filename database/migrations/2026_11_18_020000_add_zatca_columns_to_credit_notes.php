<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * REM-18b-1 — أعمدة ZATCA على `credit_notes`: **أعمدة فقط، كلها nullable، بلا قيمة افتراضية ولا Backfill**.
 *
 * هي مستودع مخرجات الإشعار الدائن حين يُربط بالترحيل (REM-18b-3). **لا أحد يكتبها اليوم**: `CreditNoteService::post` لم
 * يتغيّر، ولا `$fillable` ولا API ولا Resource. الإشعارات المرحَّلة سابقاً تبقى كلها `NULL` (`zatca_status NULL` = قديم
 * لا يُصدَر له شيء). لا فهرس فريد على `zatca_icv` عمداً: الحاجز بين المستندين هو `zatca_chain_entries(chain_id, icv)`،
 * وفهرس لكل جدول كان سيمنع تقسيم السلسلة لاحقاً (REM-25).
 *
 * `zatca_status` ∈ {generated, not_generated, disabled} — PostgreSQL: CHECK؛ SQLite: مُشغّلا إدراج/تحديث بالشرط نفسه
 * (لا يضيف CHECK بعد الإنشاء). القيمة NULL مسموحة (إشعار قديم).
 *
 * سياج F2 (لا يُرحَّل إشعار مبيعات بلا قرار ZATCA) وحارس الكتابة مرة واحدة **ليسا هنا** — REM-18b-3.
 *
 * **التراجع:** يرفض متى حمل أي إشعار أي قيمة في أي عمود من هذه الأعمدة (مخرجات صادرة لا تُحذف بالتراجع في أي بيئة)،
 * وإلا يُسقط الأعمدة فقط. لا مَسّ لأي عمود آخر.
 */
return new class extends Migration
{
    private const COLUMNS = [
        'zatca_status', 'zatca_skip_reason', 'zatca_document_type', 'zatca_reason_code', 'issued_at', 'party_snapshot',
        'zatca_uuid', 'zatca_icv', 'zatca_previous_hash', 'zatca_hash', 'zatca_qr', 'zatca_xml',
    ];

    public function up(): void
    {
        Schema::table('credit_notes', function (Blueprint $table) {
            $table->string('zatca_status', 20)->nullable();          // generated | not_generated | disabled
            $table->string('zatca_skip_reason', 64)->nullable();     // رمز مصنَّف عند not_generated/disabled
            $table->string('zatca_document_type', 20)->nullable();   // standard | simplified — نسخ من الفاتورة الأصلية
            $table->string('zatca_reason_code', 64)->nullable();     // أحد رموز ZatcaNoteReason
            $table->timestamp('issued_at', 0)->nullable();           // UTC بدقة ثانية
            $table->json('party_snapshot')->nullable();              // json لا jsonb: النص كما كُتب (كالفاتورة)
            $table->uuid('zatca_uuid')->nullable();
            $table->unsignedBigInteger('zatca_icv')->nullable();
            $table->string('zatca_previous_hash')->nullable();
            $table->string('zatca_hash')->nullable();
            $table->text('zatca_qr')->nullable();
            $table->longText('zatca_xml')->nullable();
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement(<<<'SQL'
                ALTER TABLE credit_notes
                    ADD CONSTRAINT credit_notes_zatca_status_chk CHECK (
                        zatca_status IS NULL OR zatca_status IN ('generated','not_generated','disabled')
                    )
                SQL);

            return;
        }

        foreach (['INSERT' => 'insert', 'UPDATE OF zatca_status' => 'update'] as $event => $suffix) {
            DB::unprepared(<<<SQL
                CREATE TRIGGER credit_notes_zatca_status_{$suffix}
                BEFORE {$event} ON credit_notes
                WHEN NEW.zatca_status IS NOT NULL AND NEW.zatca_status NOT IN ('generated','not_generated','disabled')
                BEGIN
                    SELECT RAISE(ABORT, 'credit_notes: invalid zatca_status');
                END
                SQL);
        }
    }

    public function down(): void
    {
        $populated = DB::table('credit_notes')->where(function ($query) {
            foreach (self::COLUMNS as $column) {
                $query->orWhereNotNull($column);
            }
        })->exists();

        if ($populated) {
            throw new RuntimeException(
                'Rollback refused: credit_notes carry ZATCA issuance data. '
                .'Issued credit-note artifacts are never discarded by rollback in any environment; use a forward-only migration instead.'
            );
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_zatca_status_chk');
        } else {
            DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_status_insert');
            DB::unprepared('DROP TRIGGER IF EXISTS credit_notes_zatca_status_update');
        }

        Schema::table('credit_notes', function (Blueprint $table) {
            $table->dropColumn(self::COLUMNS);
        });
    }
};

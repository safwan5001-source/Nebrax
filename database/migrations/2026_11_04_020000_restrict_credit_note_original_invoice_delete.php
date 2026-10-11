<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * ═══════════════════════════════════════════════════════════════
     *  AWJ-TAX-REM-02 (ACC-06) — فاتورة يُشار إليها لا تُحذف
     * ═══════════════════════════════════════════════════════════════
     *  `credit_notes.original_invoice_id` كان `nullOnDelete`: حذف الفاتورة كان
     *  يفكّ مرجع إشعارٍ دائن مرحَّل بصمت فيفقد أثره الرجعي وسقف الاعتماد.
     *  يصير `restrictOnDelete` كما في `pos_exchanges.original_invoice_id`.
     *
     *  ── التحقق قبل التقييد (لا تعديل صامت لبيانات تاريخية)
     *
     *  - مرجعٌ **معلّق** (لا فاتورة بالمعرّف): لا يمكن أن ينشأ مع مفتاح أجنبي
     *    فعّال؛ وجوده يعني قاعدةً مكسورة سابقاً، فتتوقف الهجرة برسالة صريحة بدل
     *    أن تُخفي المشكلة أو تمسح المرجع.
     *  - مرجعٌ **عابر للمستأجر** أو **لعميلٍ مختلف**: حالات تاريخية لا تُعدَّل
     *    (الإشعار المرحَّل immutable)؛ تُسجَّل أعدادها في السجل لمراجعة المالية
     *    ولا تمنع الهجرة، فالتقييد يخصّ الحذف لا صحّة المراجع القائمة.
     *
     *  ── SQLite
     *
     *  يُتخطى تغيير القيد هناك عمداً (سابقة 2026_08_31_020000): إعادة بناء
     *  الجدول عبر dropForeign تُسقط الفهارس الجزئية لترقيم الفروع على SQLite
     *  (انظر هجرتَي الإصلاح 91/93). الإنتاج PostgreSQL؛ وحارسُ التطبيق
     *  `InvoiceService::deleteDraft` يعطي رفضاً مفهوماً على السائقين كليهما.
     */
    public function up(): void
    {
        $this->assertNoDanglingReferences();
        $this->reportHistoricalMismatches();

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            $this->rebindPostgres('RESTRICT');
        }
    }

    public function down(): void
    {
        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            $this->rebindPostgres('SET NULL');
        }
    }

    private function assertNoDanglingReferences(): void
    {
        $dangling = DB::table('credit_notes as c')
            ->leftJoin('invoices as i', 'i.id', '=', 'c.original_invoice_id')
            ->whereNotNull('c.original_invoice_id')
            ->whereNull('i.id')
            ->count();

        if ($dangling > 0) {
            throw new RuntimeException(
                "REM-02: {$dangling} إشعاراً دائناً يشير إلى فاتورة غير موجودة. صحّح المراجع المعلّقة يدوياً "
                . 'قبل تقييد حذف الفاتورة المصدر — لا تعدّل الهجرة بيانات تاريخية.'
            );
        }
    }

    private function reportHistoricalMismatches(): void
    {
        $base = fn () => DB::table('credit_notes as c')
            ->join('invoices as i', 'i.id', '=', 'c.original_invoice_id');

        $crossTenant = $base()->whereColumn('i.tenant_id', '!=', 'c.tenant_id')->count();
        $otherCustomer = $base()->whereColumn('i.tenant_id', '=', 'c.tenant_id')
            ->whereColumn('i.partner_id', '!=', 'c.partner_id')->count();
        $draftSource = $base()->where('i.status', '!=', 'posted')->count();
        // مسوّدات تشير إلى فاتورة بلا ربط سطري: يُعاد ربطها بالمنتج عند الترحيل أو
        // يُرفض ترحيلها برسالة واضحة إن التبس المنتج (انظر CreditNoteService::rederiveLines).
        $legacyDrafts = $base()->where('c.status', 'draft')->count();
        // إشعارات مرحَّلة بأسطر بلا ربط سطري: يُنسب منها عند القراءة ما له سطر فاتورة وحيد
        // بمنتجه (انظر ReturnSourceAllocator::legacyCreditRows)؛ الباقي (بلا منتج/ملتبس) لا يُحسب
        // في السقف التراكمي فيحتاج مراجعة المالية.
        $legacyPostedLines = DB::table('credit_note_lines as l')
            ->join('credit_notes as c', 'c.id', '=', 'l.credit_note_id')
            ->where('c.status', 'posted')->whereNotNull('c.original_invoice_id')
            ->whereNull('l.product_id')->count();

        if ($crossTenant + $otherCustomer + $draftSource + $legacyDrafts + $legacyPostedLines > 0) {
            Log::warning('REM-02: historical credit notes reference questionable invoices (left untouched).', [
                'cross_tenant' => $crossTenant,
                'other_customer' => $otherCustomer,
                'non_posted_source' => $draftSource,
                'draft_notes_without_line_links' => $legacyDrafts,
                'posted_invoice_note_lines_without_product' => $legacyPostedLines,
            ]);
        }
    }

    private function rebindPostgres(string $onDelete): void
    {
        $row = DB::selectOne(
            'SELECT tc.constraint_name AS name
               FROM information_schema.table_constraints AS tc
               JOIN information_schema.key_column_usage AS kcu
                 ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
              WHERE tc.constraint_type = ?
                AND tc.table_schema = current_schema()
                AND tc.table_name = ?
                AND kcu.column_name = ?
              LIMIT 1',
            ['FOREIGN KEY', 'credit_notes', 'original_invoice_id']
        );
        $constraint = is_object($row) && isset($row->name) ? (string) $row->name : 'credit_notes_original_invoice_id_foreign';

        DB::statement("ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS \"{$constraint}\"");
        DB::statement(
            "ALTER TABLE credit_notes ADD CONSTRAINT \"{$constraint}\" FOREIGN KEY (original_invoice_id) "
            . "REFERENCES invoices(id) ON DELETE {$onDelete}"
        );
    }
};

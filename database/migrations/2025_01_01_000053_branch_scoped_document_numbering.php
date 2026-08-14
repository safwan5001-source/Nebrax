<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الترقيم بالفرع: توسيع القيد الفريد + تحصين عدّاد ZATCA
 * ═══════════════════════════════════════════════════════════════
 *  صار لكل فرع تسلسله المستقلّ، فالقيد `(tenant_id, number)` لم يعد صحيحاً:
 *  فرعان يبدآن من `INV-2026-00001` وكلاهما مشروع. يتوسّع القيد إلى
 *  `(tenant_id, branch_id, number)`.
 *
 *  **التوسيع تخفيفٌ لا تشديد:** كل بيانات فريدة تحت `(tenant_id, number)`
 *  تبقى فريدة تحت `(tenant_id, branch_id, number)` بالضرورة — فلا يفشل هذا
 *  الترحيل على أي بيانات قائمة.
 *
 *  الكيانات المصنَّفة `CompanyWide` (`journal_entries`, `payroll_runs`,
 *  `warehouses`, `branches`) تبقى على قيدها كما هو — تسلسلها مؤسسي بحكم
 *  التصنيف لا بحكم القيد.
 *
 *  ═══ عدّاد ZATCA — مسارٌ منفصل تماماً ═══
 *  `invoices.zatca_icv` **ليس رقم مستند**: هو عدّاد سلسلة إصدار ZATCA
 *  للكيان القانوني الواحد، فنطاقه `tenant_id` حصراً بحكم المواصفة ولا يدخل
 *  الفرع فيه أبداً. كان بلا قيد فريد إطلاقاً، فترحيلان متزامنان كانا
 *  ينتجان عدّاداً مكرراً **بصمت** تنكسر به السلسلة بلا أثر. القيد هنا يجعل
 *  الكسر مستحيلاً لا مكتشَفاً لاحقاً.
 */
return new class extends Migration
{
    /**
     * الجداول المرقَّمة بالفرع: اسم الجدول => عمود الرقم.
     *
     * `employees` **ليس منها** رغم وسمه بالفرع: مصنَّف `CompanyWide` لأن
     * `PayrollRun` مؤسسيٌّ يضمّ كل الموظفين، فترقيمٌ بالفرع كان يُدخل
     * `EMP-00001` مرّتين في المسيّر الواحد. يبقى على `(tenant_id, employee_no)`.
     */
    private const BRANCH_NUMBERED = [
        'invoices'              => 'number',
        'purchases'             => 'number',
        'payments'              => 'number',
        'return_documents'      => 'number',
        'quotes'                => 'number',
        'expenses'              => 'number',
        'assets'                => 'number',
        'credit_notes'          => 'number',
        'procurement_documents' => 'number',
        'stock_permits'         => 'number',
        'stocktakes'            => 'number',
        'pos_sessions'          => 'number',
    ];

    public function up(): void
    {
        foreach (self::BRANCH_NUMBERED as $table => $column) {
            Schema::table($table, function (Blueprint $t) use ($table, $column) {
                $t->dropUnique($table . '_tenant_id_' . $column . '_unique');
                $t->unique(['tenant_id', 'branch_id', $column]);
            });

            $this->guardBranchlessRows($table, $column);
        }

        $this->dedupeInvoiceCounterValues();

        Schema::table('invoices', function (Blueprint $table) {
            $table->unique(['tenant_id', 'zatca_icv']);
        });
    }

    public function down(): void
    {
        Schema::table('invoices', function (Blueprint $table) {
            $table->dropUnique('invoices_tenant_id_zatca_icv_unique');
        });

        foreach (self::BRANCH_NUMBERED as $table => $column) {
            DB::statement('DROP INDEX ' . $table . '_tenant_id_' . $column . '_branchless_unique');

            Schema::table($table, function (Blueprint $t) use ($table, $column) {
                $t->dropUnique($table . '_tenant_id_branch_id_' . $column . '_unique');
                $t->unique(['tenant_id', $column]);
            });
        }
    }

    /**
     * سدّ ثغرة الصفوف بلا فرع: **الفهرس الفريد لا يقيّد الصفوف الفارغة.**
     *
     * `NULL` لا تساوي `NULL` في مقارنات SQL، فصفّان بـ `branch_id` فارغ ورقمٍ
     * واحد يمرّان من `(tenant_id, branch_id, number)` بلا اعتراض — في
     * PostgreSQL وSQLite معاً. أي أن إدخال الفرع في المفتاح كان سيُسقط الحماية
     * كلياً عن المستندات المنشأة بلا سياق فرع (أوامر artisan، مهامّ مجدولة،
     * وبيانات ما قبل الفروع).
     *
     * فهرسٌ جزئيٌّ ثانٍ يغطّي هذه الحالة وحدها، فتكتمل التغطية:
     *   • صفٌّ بفرع    → `(tenant_id, branch_id, number)`
     *   • صفٌّ بلا فرع → `(tenant_id, number)`
     *
     * الصيغة نفسها مقبولة في المحرّكين — الفهارس الجزئية مدعومة في SQLite
     * منذ 3.8 وفي PostgreSQL منذ القِدم.
     */
    private function guardBranchlessRows(string $table, string $column): void
    {
        DB::statement(sprintf(
            'CREATE UNIQUE INDEX %s_tenant_id_%s_branchless_unique ON %s (tenant_id, %s) WHERE branch_id IS NULL',
            $table,
            $column,
            $table,
            $column
        ));
    }

    /**
     * إعادة ترقيم عدّاد ZATCA تسلسلياً لكل مستأجر قبل فرض القيد الفريد.
     *
     * العدّاد كان بلا قيد، فقد تحمل البيانات القائمة تكراراً يُفشل إنشاء
     * الفهرس. تُعاد السلسلة ١..ن بترتيبها الأصلي (العدّاد ثم زمن الإنشاء)
     * فتُحفظ الأسبقية ويزول التكرار. الفواتير غير المُرحَّلة (`zatca_icv`
     * فارغ) لا تُمسّ — والقيم الفارغة متمايزة في الفهرس الفريد.
     */
    private function dedupeInvoiceCounterValues(): void
    {
        $tenantIds = DB::table('invoices')
            ->whereNotNull('zatca_icv')
            ->distinct()
            ->pluck('tenant_id');

        foreach ($tenantIds as $tenantId) {
            $rows = DB::table('invoices')
                ->where('tenant_id', $tenantId)
                ->whereNotNull('zatca_icv')
                ->orderBy('zatca_icv')
                ->orderBy('created_at')
                ->orderBy('id')
                ->pluck('id');

            foreach ($rows as $index => $id) {
                DB::table('invoices')->where('id', $id)->update(['zatca_icv' => $index + 1]);
            }
        }
    }
};

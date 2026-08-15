<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * يستعيد الفهرس الجزئي لفواتير بلا فرع بعد تعديل مخطط الفواتير.
 *
 * هجرة 000059 تضيف مفتاحاً أجنبياً إلى جدول `invoices`. في SQLite يُنفَّذ
 * تعديل المفاتيح الأجنبية بإعادة بناء الجدول، وعند إعادة بناء المخطط يعيد
 * المحرّك إنشاء الفهارس المعرفة يدوياً دون عبارة `WHERE`. لذلك يتحول فهرس
 * الحماية من صفوف بلا فرع من فهرس جزئي إلى قيد مؤسسي شامل، فيمنع التسلسل
 * المستقل لكل فرع رغم القيد الصحيح `(tenant_id, branch_id, number)`.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP INDEX IF EXISTS invoices_tenant_id_number_branchless_unique');
        DB::statement(
            'CREATE UNIQUE INDEX invoices_tenant_id_number_branchless_unique '
            . 'ON invoices (tenant_id, number) WHERE branch_id IS NULL'
        );
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS invoices_tenant_id_number_branchless_unique');
        DB::statement(
            'CREATE UNIQUE INDEX invoices_tenant_id_number_branchless_unique '
            . 'ON invoices (tenant_id, number)'
        );
    }
};

<?php

namespace Tests\Feature;

/**
 * P1-3b-2a-0 — محاكاة صفوف فواتير تاريخية (قبل REM-13a/REM-14) أو تعديل تواريخ فاتورة مرحَّلة لأغراض اختبار فرز/نافذة.
 *
 * مُشغّلات `2027_01_20_010000_add_invoice_frozen_date_fences` ترفض في القاعدة تغيير `issued_at`/`party_snapshot`/`invoice_date` بعد الإصدار، وهذا بالضبط ما يقصده
 * التصليب. اختبارات تحتاج حالة «ما قبل الميزة» (لا يمكن لأي كود تطبيق إنتاجها) تُسقط المُشغّلات داخل المعاملة المحيطة بالاختبار (DDL معاملاتي في PostgreSQL وSQLite)
 * ثم تعيدها فوراً — نمط اختبارات سلسلة ZATCA (تُسقط الهجرة ثم تعيدها). **لا يوجد مسار تجاوز في الإنتاج.**
 */
trait SimulatesLegacyInvoiceRows
{
    /**
     * @template T
     *
     * @param  callable():T  $operation
     * @return T
     */
    protected function withoutInvoiceFrozenDateFences(callable $operation): mixed
    {
        $migration = require base_path('database/migrations/2027_01_20_010000_add_invoice_frozen_date_fences.php');
        $migration->down();
        try {
            return $operation();
        } finally {
            $migration->up();
        }
    }
}

<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  حدّ وحدة Commerce — عقد ثابت لا سلوك تجاري
 * ═══════════════════════════════════════════════════════════════
 *
 * PR-COM-0 لا يبني `CommerceOrder` ولا `Reservation` ولا أي نموذج عمل؛ هذا
 * العقد وحده هو ما يُنشأ الآن: الحد الفاصل بين تنسيق Commerce (يبدأ فعلياً
 * في PR-COM-1A وما بعدها) وسلطات المحرك المحاسبي/المخزني/الامتثالي القائمة.
 *
 * **القاعدة الملزمة:** كود Commerce (حين يوجد) لا يكتب مباشرة إلى أيٍّ من
 * `FORBIDDEN_DIRECT_WRITES`؛ يستدعي بدلاً منها الخدمة الموافقة في
 * `APPROVED_AUTHORITIES` لإحداث الأثر المقابل. `CommerceModuleBoundaryTest`
 * يحرس هذا العقد وغياب أي نموذج/مسار/ترحيل Commerce قبل الأوان.
 *
 * الأسماء هنا نصّية عمداً لا استيراد فعلي: اتجاه الاعتماد في هذا المستودع
 * أن الخدمات تعتمد على `App\Support`، لا العكس — فربط هذا العقد باستيراد
 * صنف خدمة كان سيعكس الاتجاه لغير سبب.
 *
 * المرجع: docs/plans/store/PR-COM-0-COMMERCE-MODULE-BOUNDARY-TEST-HARNESS.md
 */
final class CommerceBoundary
{
    /**
     * أهداف الكتابة المباشرة الممنوعة على كود Commerce.
     *
     * @var list<string>
     */
    public const FORBIDDEN_DIRECT_WRITES = [
        'journal_entries/journal_lines',
        'stock_movements/inventory_valuation/cogs',
        'zatca_invoice_artifacts',
        'financial_settlement_outside_approved_payment_authority',
    ];

    /**
     * السلطات المعتمدة الوحيدة لإحداث الأثر المقابل لكل هدف ممنوع أعلاه،
     * بنفس الترتيب.
     *
     * @var list<string>
     */
    public const APPROVED_AUTHORITIES = [
        \App\Services\Accounting\LedgerService::class,
        \App\Services\Accounting\InventoryService::class,
        \App\Services\Accounting\ZatcaService::class,
        \App\Services\Accounting\PaymentService::class,
    ];

    /**
     * هويات Commerce منفصلة عن نظائرها القائمة — لا تُدمج ولا تُستبدل بها.
     *
     * @var list<string>
     */
    public const DISTINCT_IDENTITIES = [
        'CommerceOrder != Invoice',
        'Reservation != StockMovement',
        'PaymentIntent != provider attempt/transaction != AWJ Payment',
        'Return != Refund != CreditNote != Exchange',
        'SalesChannel != Branch != Warehouse != PickupLocation',
        'Commerce customer identity != ERP staff User != Partner',
    ];
}

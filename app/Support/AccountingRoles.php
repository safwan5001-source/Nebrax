<?php

namespace App\Support;

/**
 * ═══════════════════════════════════════════════════════════════
 *  كتالوج أدوار توجيه الحسابات (Semantic Account Roles) — ACC-2
 * ═══════════════════════════════════════════════════════════════
 *
 * مصدر حقيقة ثابت لهوية الدور المحاسبي، لا حالة مستأجر. كل دور له كودٌ
 * قديم (legacy) يُستخدم **فقط** كقيمة افتراضية تُزرع صراحةً في تعيين
 * المستأجر (`AccountRoleMapping`) عند التهيئة/الاستعادة — وليس كمسار
 * حلٍّ بديل وقت الترحيل. لا Legacy Fallback في المحلِّل
 * (`AccountRoleResolver`)؛ الحل الوحيد المعتمد هو التعيين الصريح.
 *
 * لا يضمّ هذا الكتالوج `retained_earnings`/`opening_balances`: الأول محجوز
 * لتنفيذ الإقفال السنوي (FISCAL-2) والثاني غير مُقرَّر جعله قابلاً للضبط
 * بعد — كلاهما خارج نطاق ACC-2 صراحةً بنص الخطة الأم.
 */
final class AccountingRoles
{
    /**
     * @var array<string, array{label_ar:string,label_en:string,description_ar:string,description_en:string,legacy_code:string,domain:string,configurable:bool}>
     */
    private const ROLES = [
        'accounts_receivable' => [
            'label_ar' => 'حسابات العملاء (المدينون)',
            'label_en' => 'Accounts Receivable',
            'description_ar' => 'الحساب الذي تُقيَّد عليه مديونيات العملاء عند البيع الآجل.',
            'description_en' => 'The account customer debts are posted to on credit sales.',
            'legacy_code' => '1130',
            'domain' => 'receivables',
            'configurable' => true,
        ],
        'accounts_payable' => [
            'label_ar' => 'حسابات الموردين (الدائنون)',
            'label_en' => 'Accounts Payable',
            'description_ar' => 'الحساب الذي تُقيَّد عليه مديونيات المؤسسة للموردين عند الشراء الآجل.',
            'description_en' => 'The account supplier debts are posted to on credit purchases.',
            'legacy_code' => '2110',
            'domain' => 'payables',
            'configurable' => true,
        ],
        'sales_revenue' => [
            'label_ar' => 'إيرادات المبيعات',
            'label_en' => 'Sales Revenue',
            'description_ar' => 'حساب إيراد المبيعات الأساسي لسطور الفاتورة.',
            'description_en' => 'The primary sales revenue account for invoice lines.',
            'legacy_code' => '4110',
            'domain' => 'sales',
            'configurable' => true,
        ],
        'sales_shipping_revenue' => [
            'label_ar' => 'إيرادات الشحن',
            'label_en' => 'Shipping Revenue',
            'description_ar' => 'حساب إيراد رسوم الشحن المضافة على الفاتورة.',
            'description_en' => 'The account shipping fees charged on invoices are posted to.',
            'legacy_code' => '4130',
            'domain' => 'sales',
            'configurable' => true,
        ],
        'document_adjustment' => [
            'label_ar' => 'فروق وتسويات المستندات',
            'label_en' => 'Document Rounding & Adjustments',
            'description_ar' => 'حساب فروق التقريب والتسويات المشترك بين مستندات المبيعات والمشتريات.',
            'description_en' => 'The shared rounding/adjustment account used across sales and purchase documents.',
            'legacy_code' => '5170',
            'domain' => 'shared',
            'configurable' => true,
        ],
        'inventory_asset' => [
            'label_ar' => 'أصل المخزون',
            'label_en' => 'Inventory Asset',
            'description_ar' => 'حساب أصل المخزون في الميزانية.',
            'description_en' => 'The inventory asset account on the balance sheet.',
            'legacy_code' => '1140',
            'domain' => 'inventory',
            'configurable' => true,
        ],
        'cogs' => [
            'label_ar' => 'تكلفة البضاعة المباعة',
            'label_en' => 'Cost of Goods Sold (COGS)',
            'description_ar' => 'حساب تكلفة البضاعة المباعة عند البيع.',
            'description_en' => 'The cost of goods sold account recognized on sale.',
            'legacy_code' => '5110',
            'domain' => 'inventory',
            'configurable' => true,
        ],
        'purchase_expense' => [
            'label_ar' => 'مصروفات المشتريات العامة',
            'label_en' => 'General Purchase Expense',
            'description_ar' => 'حساب البنود غير المخزنية ضمن فواتير المشتريات.',
            'description_en' => 'The account for non-inventory line items on purchase invoices.',
            'legacy_code' => '5150',
            'domain' => 'purchases',
            'configurable' => true,
        ],
        'tax_output' => [
            'label_ar' => 'ضريبة القيمة المضافة - مخرجات',
            'label_en' => 'VAT Output',
            'description_ar' => 'حساب ضريبة المخرجات المستحقة على المبيعات.',
            'description_en' => 'The output VAT liability account on sales.',
            'legacy_code' => '2120',
            'domain' => 'tax',
            'configurable' => true,
        ],
        'tax_input' => [
            'label_ar' => 'ضريبة القيمة المضافة - مدخلات',
            'label_en' => 'VAT Input',
            'description_ar' => 'حساب ضريبة المدخلات القابلة للاسترداد على المشتريات.',
            'description_en' => 'The recoverable input VAT account on purchases.',
            'legacy_code' => '1150',
            'domain' => 'tax',
            'configurable' => true,
        ],
        'inventory_count_variance' => [
            'label_ar' => 'فروق الجرد',
            'label_en' => 'Inventory Count Variance',
            'description_ar' => 'حساب فروق الكمية الناتجة عن الجرد الدوري/المفاجئ.',
            'description_en' => 'The account for quantity variances found during stocktaking.',
            'legacy_code' => '5180',
            'domain' => 'inventory',
            'configurable' => true,
        ],
        'inventory_manual_adjustment' => [
            'label_ar' => 'التسويات المخزنية اليدوية',
            'label_en' => 'Manual Inventory Adjustment',
            'description_ar' => 'حساب التسويات اليدوية على أرصدة المخزون خارج الجرد الدوري.',
            'description_en' => 'The account for manual stock-balance adjustments outside stocktaking.',
            'legacy_code' => '5180',
            'domain' => 'inventory',
            'configurable' => true,
        ],
        'inventory_damage_loss' => [
            'label_ar' => 'التلف والفقد المخزني',
            'label_en' => 'Inventory Damage & Loss',
            'description_ar' => 'حساب التلف أو الفقد الفيزيائي للمخزون.',
            'description_en' => 'The account for physical inventory damage or loss.',
            'legacy_code' => '5180',
            'domain' => 'inventory',
            'configurable' => true,
        ],
    ];

    /** @var array<string, array{label_ar:string,label_en:string}> ترتيب العرض للمجموعات في واجهة توجيه الحسابات. */
    private const DOMAINS = [
        'receivables' => ['label_ar' => 'المدينون', 'label_en' => 'Receivables'],
        'payables' => ['label_ar' => 'الدائنون', 'label_en' => 'Payables'],
        'sales' => ['label_ar' => 'المبيعات', 'label_en' => 'Sales'],
        'purchases' => ['label_ar' => 'المشتريات', 'label_en' => 'Purchases'],
        'inventory' => ['label_ar' => 'المخزون', 'label_en' => 'Inventory'],
        'tax' => ['label_ar' => 'الضرائب', 'label_en' => 'Tax'],
        'shared' => ['label_ar' => 'مشترك بين المستندات', 'label_en' => 'Shared across documents'],
    ];

    /** @return array<string, array{label_ar:string,label_en:string,description_ar:string,description_en:string,legacy_code:string,domain:string,configurable:bool}> */
    public static function all(): array
    {
        return self::ROLES;
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::ROLES);
    }

    /** @return array{label_ar:string,label_en:string,description_ar:string,description_en:string,legacy_code:string,domain:string,configurable:bool}|null */
    public static function find(string $key): ?array
    {
        return self::ROLES[$key] ?? null;
    }

    public static function exists(string $key): bool
    {
        return array_key_exists($key, self::ROLES);
    }

    /** الحساب الافتراضي (بالكود القديم) الذي يُزرع صراحةً عند التهيئة/الاستعادة — لا يُستخدم كمسار حلٍّ بديل وقت الترحيل. */
    public static function legacyCodeFor(string $key): ?string
    {
        return self::ROLES[$key]['legacy_code'] ?? null;
    }

    public static function isConfigurable(string $key): bool
    {
        return self::ROLES[$key]['configurable'] ?? false;
    }

    /** @return array<string, array{label_ar:string,label_en:string}> */
    public static function domains(): array
    {
        return self::DOMAINS;
    }
}

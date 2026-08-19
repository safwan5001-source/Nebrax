<?php

namespace App\Services\Accounting;

use App\Models\Account;
use Illuminate\Support\Facades\DB;

/**
 * يُنشئ دليل حسابات سعودي قياسي لمستأجر جديد.
 * يُستدعى عند إنشاء الشركة.
 */
class ChartOfAccountsSeeder
{
    /**
     * البنية: [code, name_ar, name_en, type, is_group, children[]]
     */
    protected array $tree = [
        ['1', 'الأصول', 'Assets', 'asset', true, [
            ['11', 'الأصول المتداولة', 'Current Assets', 'asset', true, [
                // الحسابان النظاميان القائمان يظلان قابلين للترحيل لتوافق المستندات التاريخية.
                ['1110', 'الصندوق', 'Cash', 'asset', false, []],
                ['1120', 'البنك', 'Bank', 'asset', false, []],
                // الحسابات المسماة في وحدة الخزائن والبنوك تُنشأ فرعية تحت هاتين المجموعتين.
                ['111', 'الخزائن', 'Cash Treasuries', 'asset', true, []],
                ['112', 'الحسابات البنكية', 'Bank Accounts', 'asset', true, []],
                ['1130', 'العملاء (المدينون)', 'Accounts Receivable', 'asset', false, []],
                ['1140', 'المخزون', 'Inventory', 'asset', false, []],
                ['1150', 'ضريبة القيمة المضافة - مدخلات', 'VAT Input', 'asset', false, []],
                ['1160', 'عُهَد الموظفين', 'Employee Custodies', 'asset', false, []],
            ]],
            ['12', 'الأصول الثابتة', 'Fixed Assets', 'asset', true, [
                ['1210', 'المعدات والآليات', 'Equipment', 'asset', false, []],
                ['1220', 'وسائل النقل', 'Vehicles', 'asset', false, []],
                ['1230', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', false, []],
            ]],
        ]],
        ['2', 'الخصوم', 'Liabilities', 'liability', true, [
            ['21', 'الخصوم المتداولة', 'Current Liabilities', 'liability', true, [
                ['2110', 'الموردون (الدائنون)', 'Accounts Payable', 'liability', false, []],
                ['2120', 'ضريبة القيمة المضافة - مخرجات', 'VAT Output', 'liability', false, []],
                ['2130', 'رواتب مستحقة', 'Accrued Salaries', 'liability', false, []],
                ['2140', 'التأمينات الاجتماعية مستحقة', 'GOSI Payable', 'liability', false, []],
                ['2150', 'استقطاعات موظفين مستحقة', 'Employee Deductions Payable', 'liability', false, []],
            ]],
        ]],
        ['3', 'حقوق الملكية', 'Equity', 'equity', true, [
            ['3110', 'رأس المال', 'Capital', 'equity', false, []],
            ['3120', 'الأرباح المرحّلة', 'Retained Earnings', 'equity', false, []],
            ['3130', 'الأرصدة الافتتاحية', 'Opening Balances', 'equity', false, []],
        ]],
        ['4', 'الإيرادات', 'Revenue', 'revenue', true, [
            ['4110', 'إيرادات المبيعات', 'Sales Revenue', 'revenue', false, []],
            ['4120', 'إيرادات الخدمات', 'Service Revenue', 'revenue', false, []],
            ['4130', 'إيرادات الشحن', 'Shipping Revenue', 'revenue', false, []],
        ]],
        ['5', 'المصروفات', 'Expenses', 'expense', true, [
            ['51', 'تكلفة المبيعات', 'Cost of Sales', 'expense', true, [
                ['5110', 'تكلفة البضاعة المباعة', 'COGS', 'expense', false, []],
                // مصروف مقابل (contra): حركته دائنة فيخفّض إجمالي المصروفات.
                // يستقبل الإشعارات المدينة — خصومات المورّد بلا حركة مخزون.
                ['5115', 'مردودات ومسموحات المشتريات', 'Purchase Returns & Allowances', 'expense', false, []],
            ]],
            ['52', 'مصروفات إدارية وعمومية', 'Administrative & General Expenses', 'expense', true, [
                ['5120', 'الرواتب والأجور', 'Salaries', 'expense', false, []],
                ['5130', 'الإيجار', 'Rent', 'expense', false, []],
                ['5140', 'الوقود والمحروقات', 'Fuel', 'expense', false, []],
                ['5150', 'مصروفات عامة', 'General Expenses', 'expense', false, []],
            ]],
            ['53', 'مصروفات الإهلاك', 'Depreciation Expenses', 'expense', true, [
                ['5160', 'الإهلاك', 'Depreciation', 'expense', false, []],
            ]],
            ['54', 'مصروفات أخرى', 'Other Expenses', 'expense', true, [
                ['5170', 'فروق التقريب والتسويات', 'Rounding & Adjustments', 'expense', false, []],
                ['5180', 'فروق الجرد والتلف', 'Inventory Adjustments', 'expense', false, []],
            ]],
            ['55', 'مصاريف الدفع', 'Payment Fees', 'expense', true, []],
        ]],
    ];

    public function seed(string $tenantId): void
    {
        DB::transaction(function () use ($tenantId) {
            foreach ($this->tree as $node) {
                $this->createNode($tenantId, $node, null);
            }
        });
    }

    protected function createNode(string $tenantId, array $node, ?string $parentId): void
    {
        [$code, $nameAr, $nameEn, $type, $isGroup, $children] = $node;

        $account = Account::create([
            'tenant_id'      => $tenantId,
            'parent_id'      => $parentId,
            'code'           => $code,
            'name'           => $nameAr,
            'name_en'        => $nameEn,
            'type'           => $type,
            'normal_balance' => in_array($type, ['asset', 'expense']) ? 'debit' : 'credit',
            'is_group'       => $isGroup,
            'is_system'      => true,
        ]);

        foreach ($children as $child) {
            $this->createNode($tenantId, $child, $account->id);
        }
    }
}

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        // PR-INV-2 — يضاف الحساب الجديد صراحةً إلى المستأجرين القائمين، بنفس
        // نمط 2025_01_01_000071_create_employee_custodies.php (١١٦٠ عُهَد
        // الموظفين): لا يُعاد ترتيب أو تعديل حساباتهم الحالية، ولا يُعاد
        // تصنيف أي قيدٍ تاريخي. مرتجعات المشتريات المرحَّلة سابقاً استخدمت
        // 5180 لأي فرق قيمة — تبقى كما رُحِّلت؛ الحساب الجديد يخصّ المرتجعات
        // التي تُرحَّل بعد نشر هذا التعديل فقط.
        foreach (DB::table('tenants')->select('id')->get() as $tenant) {
            if (DB::table('accounts')->where('tenant_id', $tenant->id)->where('code', '5116')->exists()) {
                continue;
            }

            $costOfSalesGroupId = DB::table('accounts')
                ->where('tenant_id', $tenant->id)
                ->where('code', '51')
                ->value('id');

            if (! $costOfSalesGroupId) {
                continue;
            }

            DB::table('accounts')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenant->id,
                'parent_id' => $costOfSalesGroupId,
                'code' => '5116',
                'name' => 'فروق تقييم مردودات المشتريات',
                'name_en' => 'Purchase Return Valuation Variance',
                'type' => 'expense',
                'normal_balance' => 'debit',
                'is_group' => false,
                'is_system' => true,
                'currency' => 'SAR',
                'is_active' => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        // الحساب يُبقى عند العكس: قد يكون قد استُخدم في قيود لاحقة ولا يجوز
        // حذفه بلا فحص — نفس سياسة 2025_01_01_000071 لحساب 1160.
    }
};

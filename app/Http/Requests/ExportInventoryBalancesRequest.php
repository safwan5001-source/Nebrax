<?php

namespace App\Http\Requests;

use App\Services\InventoryBalanceExportService;
use App\Support\InventoryBalanceFilters;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات تصدير أرصدة المخزون.
 *
 * مرشّحات الشاشة نفسها حرفياً (`InventoryBalanceFilters::rules`) مضافاً إليها
 * النطاق والصيغة وخيار الرصيد الصفري. **بلا `page`/`per_page`**: التصدير
 * المفلتر يعني كل النتائج لا الصفحة المعروضة.
 */
class ExportInventoryBalancesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge(InventoryBalanceFilters::rules(), [
            'scope' => ['sometimes', Rule::in([
                InventoryBalanceExportService::SCOPE_FILTERED,
                InventoryBalanceExportService::SCOPE_ALL,
            ])],
            'format' => ['sometimes', Rule::in([
                InventoryBalanceExportService::FORMAT_CSV,
                InventoryBalanceExportService::FORMAT_XLSX,
            ])],
            'include_zero' => ['sometimes', 'boolean'],
        ]);
    }

    public function messages(): array
    {
        return [
            'scope.in'  => 'نطاق التصدير غير صالح.',
            'format.in' => 'صيغة التصدير يجب أن تكون CSV أو XLSX.',
        ];
    }
}

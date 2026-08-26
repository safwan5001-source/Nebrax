<?php

namespace App\Http\Requests;

use App\Services\ProductExportService;
use App\Support\ProductListFilters;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات تصدير المنتجات.
 *
 * مرشّحات القائمة نفسها حرفياً (`ProductController::listFilterRules`) مضافاً
 * إليها النطاق والصيغة والقالب. **بلا `page` و`per_page`**: التصدير المفلتر
 * يعني كل النتائج لا الصفحة المعروضة، وقبول المعاملين كان سيسمح بتصديرٍ
 * مبتور يظنّه المستخدم كاملاً.
 */
class ExportProductsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge(ProductListFilters::rules(), [
            'scope' => ['sometimes', Rule::in([
                ProductExportService::SCOPE_SELECTED,
                ProductExportService::SCOPE_FILTERED,
                ProductExportService::SCOPE_ALL,
            ])],
            'format' => ['sometimes', Rule::in([
                ProductExportService::FORMAT_CSV,
                ProductExportService::FORMAT_XLSX,
            ])],
            'template' => ['sometimes', Rule::in([
                ProductExportService::TEMPLATE_CATALOG,
                ProductExportService::TEMPLATE_ROUND_TRIP,
            ])],
            'ids' => ['sometimes', 'array', 'max:'.ProductExportService::MAX_SELECTED_IDS],
            'ids.*' => ['uuid'],
        ]);
    }

    public function messages(): array
    {
        return [
            'scope.in' => 'نطاق التصدير غير صالح.',
            'format.in' => 'صيغة التصدير يجب أن تكون CSV أو XLSX.',
            'template.in' => 'قالب التصدير غير صالح.',
            'ids.max' => 'عدد المنتجات المحددة يتجاوز الحد المسموح في تصدير واحد.',
            'ids.*.uuid' => 'أحد معرّفات المنتجات المحددة غير صالح.',
        ];
    }
}

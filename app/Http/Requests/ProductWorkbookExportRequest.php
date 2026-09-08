<?php

namespace App\Http\Requests;

use App\Support\ProductListFilters;
use Illuminate\Foundation\Http\FormRequest;

/**
 * مدخلات تصدير مصنّف PR-UOM2-4. مرشّحات القائمة نفسها حرفياً كتصدير
 * المنتجات أحادي الورقة (`ExportProductsRequest`)، مضافاً إليها
 * `price_list_id` الإلزامي — القرار D-F: بلا قائمةٍ محدَّدة لا تُصدَّر ورقة
 * Unit Prices، ولا يُخمَّن بديلٌ عنها.
 */
class ProductWorkbookExportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge(ProductListFilters::rules(), [
            'price_list_id' => ['required', 'uuid'],
            'ids' => ['sometimes', 'array'],
            'ids.*' => ['uuid'],
            'scope' => ['sometimes', 'string', 'in:selected,filtered,all'],
        ]);
    }

    public function messages(): array
    {
        return [
            'price_list_id.required' => 'حدّد قائمة سعرٍ واحدة قبل تصدير مصنّف Unit Prices.',
            'price_list_id.uuid' => 'معرّف قائمة السعر غير صالح.',
        ];
    }
}

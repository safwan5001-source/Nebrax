<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreStockPermitRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'                => ['required', 'in:receipt,issue,transfer'],
            'warehouse_id'        => ['required', 'uuid'],
            'target_warehouse_id' => ['nullable', 'uuid'],
            'permit_date'         => ['nullable', 'date'],
            'reason'              => ['nullable', 'string', 'max:255'],
            'notes'               => ['nullable', 'string', 'max:500'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['required', 'uuid'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            // غياب الوحدة = وحدة الأساس بمعامل ١ صراحةً (توافق المستندات القديمة)؛
            // وحدةٌ غير معروفة على قالب المنتج تُرفض ولا تُفترَض معاملاً.
            'items.*.unit'        => ['nullable', 'string', 'max:255'],
            // تكلفة الإضافة وحدها تُدخَل، وهي بالوحدة المُدخَلة أعلاه (لا وحدة
            // الأساس بالضرورة) — الصرف والتحويل يأخذان المتوسط دائماً.
            'items.*.unit_cost'   => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات
        ];
    }
}

<?php

namespace App\Http\Requests;

use App\Models\Product;
use App\Tenancy\BranchScope;
use Closure;
use Illuminate\Foundation\Http\FormRequest;

/**
 * عقد إنشاء منتج عبر الـ Public API — **قائمة سماح صريحة** لمنتجٍ أساسيٍّ آمن.
 *
 * `validated()` يعيد المُدرَج هنا فقط، فيُسقَط أيّ حقلٍ آخر: تكلفة الشراء، الكمية
 * الابتدائية/الأرصدة المخزنية، حسابات المبيعات/التكلفة، المورّد/التصنيف/العلامة/
 * قالب الوحدات، الهوامش والملاحظات الداخلية، وtenant_id. فلا أثر مخزني ولا محاسبي
 * ولا حقن مراجع. النقود بالوحدات الصغرى (`sale_price_minor`).
 *
 * تفرد SKU/الباركود على مستوى **المستأجر** (عبر الفروع): عميل الـ API لا سياق فرع
 * له، فيُفحص الرمز مؤسسيًا بتجاوز نطاق الفرع مع بقاء نطاق المستأجر والحذف الناعم.
 */
class PublicStoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'             => ['required', 'string', 'max:255'],
            'name_en'          => ['nullable', 'string', 'max:255'],
            'type'             => ['nullable', 'in:good,service'],
            'unit'             => ['nullable', 'string', 'max:255'],
            'description'      => ['nullable', 'string', 'max:2000'],
            'sku'              => ['nullable', 'string', 'max:255', $this->uniqueWithinTenant('sku', 'رمز المنتج (SKU)')],
            'barcode'          => ['nullable', 'string', 'max:255', $this->uniqueWithinTenant('barcode', 'الباركود')],
            'sale_price_minor' => ['required', 'integer', 'min:0', 'max:100000000000'],
            'tax_rate'         => ['nullable', 'integer', 'min:0', 'max:100'],
            'is_active'        => ['nullable', 'boolean'],
        ];
    }

    /** قاعدة تفرّد على مستوى المستأجر (كل الفروع) لعمودٍ نصّي. */
    private function uniqueWithinTenant(string $column, string $label): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) use ($column, $label): void {
            if ($value === null || $value === '') {
                return;
            }

            $exists = Product::withoutGlobalScope(BranchScope::class)
                ->where($column, $value)
                ->exists();

            if ($exists) {
                $fail("{$label} مستخدم بالفعل.");
            }
        };
    }
}

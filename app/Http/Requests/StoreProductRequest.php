<?php

namespace App\Http\Requests;

use App\Models\Product;
use App\Support\BranchSettings;
use App\Tenancy\BranchContext;
use App\Tenancy\BranchScope;
use Closure;
use Illuminate\Foundation\Http\FormRequest;

class StoreProductRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $productId     = $this->route('id');
        $shareProducts = BranchSettings::sharing()['share_products'];
        $branchId      = app(BranchContext::class)->id();

        return [
            'name'            => ['required', 'string', 'max:255'],
            'name_en'         => ['nullable', 'string', 'max:255'],
            // عند المشاركة يكون الكتالوج مؤسسياً، فيفحص الرمز في جميع الفروع.
            // وعند الفصل يكون الرمز محلياً للفرع، مع حجز رموز المنتجات
            // المؤسسية/القديمة (branch_id = null) الظاهرة لجميع الفروع.
            'sku'             => [
                'nullable',
                'string',
                'max:255',
                function (string $attribute, mixed $value, Closure $fail) use ($productId, $shareProducts, $branchId): void {
                    if ($value === null || $value === '') {
                        return;
                    }

                    $duplicates = Product::withoutGlobalScope(BranchScope::class)
                        ->where('sku', $value)
                        ->whereNull('deleted_at')
                        ->when($productId, fn ($query) => $query->where('id', '!=', $productId));

                    if (! $shareProducts && $branchId !== null) {
                        $duplicates->where(function ($query) use ($branchId) {
                            $query->where('branch_id', $branchId)->orWhereNull('branch_id');
                        });
                    }

                    if ($duplicates->exists()) {
                        $fail('رمز المنتج (SKU) مستخدم بالفعل في نطاق الكتالوج الحالي.');
                    }
                },
            ],
            'barcode'         => ['nullable', 'string', 'max:255'],
            'type'            => ['required', 'in:good,service'],
            'unit'            => ['nullable', 'string', 'max:255'],
            'description'     => ['nullable', 'string', 'max:2000'],
            // النصّان الحرّان يبقيان مقبولَين للتوافق الخلفي مع أي مستهلك قائم
            // للـ API؛ المُعرّفان أدناه هما مصدر الحقيقة الجديد.
            'category'        => ['nullable', 'string', 'max:255'],
            'brand'           => ['nullable', 'string', 'max:255'],
            'category_id'     => ['nullable', 'uuid'],
            'brand_id'        => ['nullable', 'uuid'],
            'unit_template_id' => ['nullable', 'uuid'],
            'reorder_level'   => ['nullable', 'integer', 'min:0'],
            'supplier_id'     => ['nullable', 'uuid'],
            'sales_account_id' => ['nullable', 'uuid'],
            'cogs_account_id' => ['nullable', 'uuid'],
            'min_sale_price'  => ['nullable', 'integer', 'min:0'],
            'discount'        => ['nullable', 'integer', 'min:0'],
            'discount_type'   => ['nullable', 'in:percent,amount'],
            'profit_margin'   => ['nullable', 'integer', 'min:0', 'max:1000'],
            'tags'            => ['nullable', 'string', 'max:500'],
            'internal_notes'  => ['nullable', 'string', 'max:2000'],
            // الأسعار بالهللات (minor units) كأعداد صحيحة
            'sale_price'      => ['required', 'integer', 'min:0'],
            'purchase_price'  => ['nullable', 'integer', 'min:0'],
            'tax_rate'        => ['nullable', 'integer', 'min:0', 'max:100'],
            'track_inventory' => ['boolean'],
            'initial_quantity' => ['nullable', 'integer', 'min:0'], // رصيد افتتاحي (فعل، ليس عموداً)
            'is_active'       => ['boolean'],
        ];
    }
}

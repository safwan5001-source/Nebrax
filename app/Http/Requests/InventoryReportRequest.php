<?php

namespace App\Http\Requests;

use App\Models\StockPermit;
use App\Services\Reporting\InventoryReportService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مرشحات تقارير المخزون: كل الحقول اختيارية باستثناء العرض المصرّح به.
 *
 * لا تسمح القوائم البيضاء بتمرير أعمدة أو أنواع حركة عشوائية إلى طبقة القراءة.
 */
class InventoryReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'view' => ['required', Rule::in(InventoryReportService::VIEWS)],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'branch_id' => ['nullable', 'array'],
            'branch_id.*' => ['uuid'],
            'product_id' => ['nullable', 'uuid'],
            'warehouse_id' => ['nullable', 'uuid'],
            'movement_type' => ['nullable', Rule::in(InventoryReportService::MOVEMENT_TYPES)],
            'operation_type' => ['nullable', Rule::in(StockPermit::TYPES)],
            'hide_zero' => ['nullable', 'boolean'],
        ];
    }
}

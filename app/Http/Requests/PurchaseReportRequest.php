<?php

namespace App\Http\Requests;

use App\Services\Reporting\PurchaseReportService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مرشحات تقارير المشتريات: كل الحقول اختيارية باستثناء نوع العرض.
 *
 * قوائم السماح تحمي من تمرير عبارات SQL أو أعمدة فرز من العميل، والـ UUID لا
 * يتجاوز TenantScope أو العزل الصريح للفروع داخل خدمة التقرير.
 */
class PurchaseReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'view'            => ['required', Rule::in(PurchaseReportService::VIEWS)],
            'from'            => ['nullable', 'date'],
            'to'              => ['nullable', 'date', 'after_or_equal:from'],
            'interval'        => ['nullable', Rule::in(PurchaseReportService::INTERVALS)],
            'branch_id'       => ['nullable', 'array'],
            'branch_id.*'     => ['uuid'],
            'supplier_id'     => ['nullable', 'uuid'],
            'product_id'      => ['nullable', 'uuid'],
            'creator_id'      => ['nullable', 'uuid'],
            'payment_status'  => ['nullable', Rule::in(['paid', 'partial', 'unpaid'])],
            'received_status' => ['nullable', Rule::in(['pending', 'partial', 'received'])],
            'payment_method'  => ['nullable', Rule::in(['cash', 'bank'])],
        ];
    }
}

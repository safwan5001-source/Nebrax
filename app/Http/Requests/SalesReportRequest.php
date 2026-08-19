<?php

namespace App\Http\Requests;

use App\Services\Reporting\SalesReportService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مرشحات تقارير المبيعات: كل الحقول اختيارية باستثناء نوع العرض.
 *
 * لا تُستخدم أسماء أعمدة أو عبارات فرز قادمة من العميل؛ أنواع العرض والخيارات
 * قوائم بيضاء في الخدمة، والـ UUIDs لا تعني تجاوز TenantScope داخل الاستعلام.
 */
class SalesReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'view'            => ['required', Rule::in(SalesReportService::VIEWS)],
            'from'            => ['nullable', 'date'],
            'to'              => ['nullable', 'date', 'after_or_equal:from'],
            'interval'        => ['nullable', Rule::in(SalesReportService::INTERVALS)],
            'branch_id'       => ['nullable', 'array'],
            'branch_id.*'     => ['uuid'],
            'customer_id'     => ['nullable', 'uuid'],
            'product_id'      => ['nullable', 'uuid'],
            'salesperson_id'  => ['nullable', 'uuid'],
            'payment_status'  => ['nullable', Rule::in(['paid', 'partial', 'unpaid'])],
            'receipt_method'  => ['nullable', Rule::in(['cash', 'bank'])],
        ];
    }
}

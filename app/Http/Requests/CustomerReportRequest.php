<?php

namespace App\Http\Requests;

use App\Services\Reporting\CustomerReportService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** مرشحات تقارير العملاء؛ كلّها اختيارية باستثناء نوع العرض المصرّح به. */
class CustomerReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'view' => ['required', Rule::in(CustomerReportService::VIEWS)],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'interval' => ['nullable', Rule::in(CustomerReportService::INTERVALS)],
            'branch_id' => ['nullable', 'array'],
            'branch_id.*' => ['uuid'],
            'customer_id' => ['nullable', 'uuid'],
            'payment_status' => ['nullable', Rule::in(['paid', 'partial', 'unpaid'])],
            'payment_method' => ['nullable', Rule::in(['cash', 'bank'])],
            'appointment_status' => ['nullable', Rule::in(['scheduled', 'done', 'cancelled'])],
        ];
    }
}

<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * مرشحات تقرير قنوات التوصيل. التواريخ اختيارية مثل تقارير المبيعات،
 * والنطاق المقلوب مرفوض. لا يُقبل فلتر حالة ولا حالة سداد: البيع مثبت
 * على الفواتير المرحّلة فقط.
 */
class DeliveryChannelReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'branch_id' => ['nullable', 'array'],
            'branch_id.*' => ['uuid'],
            'delivery_platform_profile_id' => ['nullable', 'uuid'],
        ];
    }
}

<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreEmployeeCustodySettlementRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * الأرقام الصحيحة فقط: مقدار التسوية يحفظ ويُمرر إلى دفتر الأستاذ بالهللات.
     * التحقق من صلاحية الحساب والنوع والعهدة والرصيد يتم في الخدمة ضمن المعاملة.
     */
    public function rules(): array
    {
        return [
            'settlement_type_id' => ['required', 'uuid'],
            'debit_account_id' => ['required', 'uuid'],
            'settlement_date' => ['required', 'date'],
            'amount' => ['required', 'integer', 'min:1', 'max:100000000000'],
            'notes' => ['nullable', 'string', 'max:5000'],
        ];
    }
}

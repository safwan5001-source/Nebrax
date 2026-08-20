<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * يتحقق من بنية مسودة القيد. التوازن ليس شرط حفظ المسودة؛ يفرضه LedgerService
 * عند الترحيل حتى لا تعتمد سلامة الدفتر على واجهة أو طلب HTTP.
 */
class StoreManualJournalRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'entry_date' => ['nullable', 'date'],
            'description' => ['nullable', 'string', 'max:1000'],
            'lines' => ['required', 'array', 'min:2', 'max:100'],
            'lines.*.account_id' => ['required', 'uuid'],
            'lines.*.description' => ['nullable', 'string', 'max:1000'],
            'lines.*.debit' => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'lines.*.credit' => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'lines.*.partner_id' => ['nullable', 'uuid'],
            'lines.*.cost_center_id' => ['nullable', 'uuid'],
        ];
    }
}

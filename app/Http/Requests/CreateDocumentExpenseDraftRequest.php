<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class CreateDocumentExpenseDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'expected_version' => ['required', 'integer', 'min:1'],
            'reason' => ['required', 'string', 'max:500'],
            'account_id' => ['required', 'uuid'],
            'category_id' => ['nullable', 'uuid'],
            'cost_center_id' => ['nullable', 'uuid'],
            'payment_method' => ['required', 'string', 'in:cash,bank,credit'],

            // حقائق المجال والسياق والدليل المراجع محمية من العميل؛ الباني يستخرجها
            // حصراً من projection المراجع وTenant/Branch الحاليين.
            'tenant_id' => ['prohibited'],
            'branch_id' => ['prohibited'],
            'amount' => ['prohibited'],
            'tax_amount' => ['prohibited'],
            'total' => ['prohibited'],
            'tax_rate' => ['prohibited'],
            'document_date' => ['prohibited'],
            'document_number' => ['prohibited'],
            'vendor_name' => ['prohibited'],
            'status' => ['prohibited'],
            'number' => ['prohibited'],
            'normalized_payload' => ['prohibited'],
            'provider_metadata' => ['prohibited'],
            'raw_provider_response' => ['prohibited'],
        ];
    }
}

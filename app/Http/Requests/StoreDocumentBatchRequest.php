<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDocumentBatchRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'document_type' => ['required', 'string', Rule::in([
                'purchase_invoice',
                'sales_invoice',
                'expense',
                'delivery_note',
                'receipt',
                'credit_note',
                'debit_note',
            ])],
        ];
    }
}

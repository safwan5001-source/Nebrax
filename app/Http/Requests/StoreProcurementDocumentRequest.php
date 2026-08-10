<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreProcurementDocumentRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'type'                => ['required', 'in:request,rfq,quotation,order'],
            'partner_id'          => ['nullable', 'uuid'],
            'doc_date'            => ['nullable', 'date'],
            'due_date'            => ['nullable', 'date'],
            'requested_by'        => ['nullable', 'string', 'max:255'],
            'tax_inclusive'       => ['nullable', 'boolean'],
            'notes'               => ['nullable', 'string', 'max:500'],
            'source_document_id'  => ['nullable', 'uuid'],
            'supplier_ids'        => ['nullable', 'array'],
            'supplier_ids.*'      => ['uuid'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['nullable', 'uuid'],
            'items.*.description' => ['nullable', 'string'],
            'items.*.quantity'    => ['required', 'integer', 'min:1', 'max:1000000'],
            // السعر اختياري وصفرٌ مسموح: طلب الشراء وطلب العروض يحدّدان المطلوب لا ثمنه.
            'items.*.unit_price'  => ['nullable', 'integer', 'min:0', 'max:100000000000'], // هللات
            'items.*.tax_rate'    => ['nullable', 'integer', 'min:0', 'max:100'],
        ];
    }
}

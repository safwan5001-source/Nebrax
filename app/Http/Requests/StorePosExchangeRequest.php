<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StorePosExchangeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // R4 — مفتاح محاولة منطقية ثابتة يحمي العملية الذرية الكاملة
            // (مرتجع + بديل + تسوية فائض) من التكرار المالي/المخزني عند
            // إعادة إرسال نفس الطلب.
            'idempotency_key' => ['required', 'uuid'],
            'pos_session_id' => ['required', 'uuid'],
            'original_invoice_id' => ['required', 'uuid'],
            'return_items' => ['required', 'array', 'min:1'],
            'return_items.*.source_line_id' => ['required', 'uuid', 'distinct'],
            'return_items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            'restock' => ['nullable', 'boolean'],
            'surplus_refund_method' => ['nullable', 'in:credit,cash'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'replacement' => ['required', 'array'],
            'replacement.tax_inclusive' => ['nullable', 'boolean'],
            'replacement.items' => ['required', 'array', 'min:1'],
            'replacement.items.*.product_id' => ['nullable', 'uuid'],
            'replacement.items.*.description' => ['nullable', 'string'],
            'replacement.items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            // R2 — كانت غائبة عن هذا العقد فتُسقَط صامتة من validated()، فيفقد
            // طرف البديل قدرته على بيع وحدة بديلة رغم أن PosService::checkout
            // (نفسه مسار /pos/checkout المباشر) يدعمها بالكامل. لا تغيّر سلوكاً
            // قائماً — كل طلب سابق كان يرسلها ضمناً بلا وحدة أصلاً (بيع بوحدة
            // الأساس)، وهذا يفتح فقط ما كان مسموحاً في مسار البيع المباشر.
            'replacement.items.*.unit' => ['nullable', 'string', 'max:100'],
            'replacement.items.*.unit_price' => ['required', 'integer', 'min:0', 'max:100000000000'],
            'replacement.items.*.tax_rate' => ['nullable', 'integer', 'min:0', 'max:100'],
            'replacement.items.*.discount' => ['nullable', 'integer', 'min:0', 'max:100000000000'],
            'replacement.items.*.minimum_price_override_reason' => ['nullable', 'string', 'min:3', 'max:500'],
            'replacement.tenders' => ['required', 'array'],
            'replacement.tenders.cash' => ['nullable', 'integer', 'min:0'],
            'replacement.tenders.card' => ['nullable', 'integer', 'min:0'],
            'replacement.tenders.transfer' => ['nullable', 'integer', 'min:0'],
            // رصيد المرتجع يطبّقه الخادم حصراً ويضاف فوق أي رصيد جديد يختاره
            // الكاشير لفرق البيع البديل؛ لا يرسل العميل مبلغ الرصيد المطبق نفسه.
            'replacement.tenders.credit' => ['nullable', 'integer', 'min:0'],
        ];
    }
}

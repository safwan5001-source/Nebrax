<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use App\Support\PaymentMethodVisual;
use Illuminate\Validation\Rule;

class StorePaymentMethodRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'name_en' => ['nullable', 'string', 'max:255'],
            'settlement_type' => ['required', Rule::in(['cash', 'bank'])],
            'cash_bank_account_id' => ['required', 'uuid'],
            'instructions' => ['nullable', 'string', 'max:1000'],
            'available_online' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
            'is_default' => ['sometimes', 'boolean'],
            // D-09: NULL/غياب = بلا مقاصة (A11). الفحص الموضوعي (نوع الطريقة، اتصال المستأجر النشط) في المتحكّم.
            'pos_clearing_gateway_id' => ['sometimes', 'nullable', 'uuid'],
            // H6-02: تشترط موافقة جهاز مؤكدة لكل بيع POS بها (افتراضي false = مطفأ).
            'pos_terminal_required' => ['sometimes', 'boolean'],
            // تخصيص بصري اختياري؛ الغياب يُبقي القائم. الشعار نفسه يُرفع عبر مسار منفصل.
            'visual_mode' => ['sometimes', 'nullable', Rule::in(PaymentMethodVisual::MODES)],
            'icon_key' => ['sometimes', 'nullable', Rule::in(PaymentMethodVisual::ICON_KEYS)],
            'icon_color' => ['sometimes', 'nullable', 'string', 'regex:'.PaymentMethodVisual::COLOR_PATTERN],
        ];
    }
}

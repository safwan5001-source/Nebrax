<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class OpenPosSessionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'opening_balance' => ['required', 'integer', 'min:0'], // هللات
            'pos_device_id'   => ['required', 'uuid'],
            // المصدر الجديد لوردية تشغيل POS. يبقى shift_id مؤقتاً للتوافق
            // مع العملاء/الجلسات التاريخية فقط، ولا يُستخدم لفتح جلسة جديدة.
            'pos_shift_id'    => ['required', 'uuid'],
            'shift_id'        => ['nullable', 'uuid'],
        ];
    }
}

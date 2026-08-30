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
            // المسار الجديد. الواجهة الجديدة ترسله دائماً، لكنه يبقى nullable
            // خلال نافذة الترحيل حتى لا نكسر عملاء API القديمة دفعة واحدة.
            'pos_shift_id'    => ['nullable', 'uuid'],
            // توافق مرحلي فقط مع تكاملات POS القديمة. لا تستخدمه الواجهة الجديدة.
            'shift_id'        => ['nullable', 'uuid'],
        ];
    }
}

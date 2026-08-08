<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class StoreWarehouseRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name'       => ['required', 'string', 'max:255'],
            'code'       => ['nullable', 'string', 'max:50'], // يُولَّد تلقائياً حين يُترك فارغاً
            'branch_id'  => ['nullable', 'uuid'],             // لا فرع = مخزن مركزي
            'city'       => ['nullable', 'string', 'max:100'],
            'address'    => ['nullable', 'string', 'max:255'],
            'notes'      => ['nullable', 'string', 'max:2000'],
            'is_default' => ['nullable', 'boolean'],
            'is_active'  => ['nullable', 'boolean'],
        ];
    }
}

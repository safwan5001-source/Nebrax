<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** FUEL-B5.1: تكلفة الاستلام الفعلية الإجمالية بالهللات — موجبة فقط (الصفر ليس تكلفة فعلية). */
class RecordFuelDeliveryCostRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'received_total_cost_minor' => ['required', 'integer', 'min:1'],
        ];
    }
}

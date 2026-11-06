<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** FUEL-B5.1: التحقق من المحتوى الفعلي والنوع والحجم في `FuelDeliveryAttachmentService`؛ هنا شكل الطلب فقط. */
class StoreFuelDeliveryAttachmentsRequest extends FormRequest
{
    public function authorize(): bool { return true; }

    public function rules(): array
    {
        return [
            'attachments' => ['required', 'array', 'min:1', 'max:5'],
            'attachments.*' => ['file'],
        ];
    }
}

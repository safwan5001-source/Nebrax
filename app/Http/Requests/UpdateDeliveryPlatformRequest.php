<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** تعديل ملف منصة توصيل = نسخة جديدة. هوية المنصة والقناة ثابتتان. */
class UpdateDeliveryPlatformRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'platform_key' => ['prohibited'],
            'sales_channel_id' => ['prohibited'],
            ...StoreDeliveryPlatformRequest::configRules(),
        ];
    }
}

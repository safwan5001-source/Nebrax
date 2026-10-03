<?php

namespace App\Http\Requests;

use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Support\DeliveryPlatformCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** إنشاء ملف منصة توصيل — إعداد فقط، بلا أي أثر مالي. */
class StoreDeliveryPlatformRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'platform_key' => ['required', 'string', Rule::in(DeliveryPlatformCatalog::keys())],
            'sales_channel_id' => ['nullable', 'uuid'],
            ...self::configRules(),
        ];
    }

    /** @return array<string, array<int, mixed>> */
    public static function configRules(): array
    {
        return [
            'collection_mode' => ['nullable', 'string', Rule::in(Version::COLLECTION_MODES)],
            'external_reference_policy' => ['nullable', 'string', Rule::in(Version::REFERENCE_POLICIES)],
            'display_name' => ['nullable', 'string', 'max:255'],
            'display_name_en' => ['nullable', 'string', 'max:255'],
            // مفتاح أصل داخلي لا رابط خارجي: لا مخطط ولا نطاق ولا `..` ولا بداية بـ`/`.
            'logo_asset_key' => ['nullable', 'string', 'max:255', 'regex:/^(?!.*\.\.)(?!\/)[A-Za-z0-9._\-\/]+$/'],
            'is_active' => ['nullable', 'boolean'],
            'change_reason' => ['nullable', 'string', 'max:500'],
            'branch_overrides' => ['nullable', 'array', 'max:200'],
            'branch_overrides.*' => ['array:branch_id,collection_mode,external_reference_policy'],
            'branch_overrides.*.branch_id' => ['required', 'uuid'],
            'branch_overrides.*.collection_mode' => ['nullable', 'string', Rule::in(Version::COLLECTION_MODES)],
            'branch_overrides.*.external_reference_policy' => ['nullable', 'string', Rule::in(Version::REFERENCE_POLICIES)],
        ];
    }
}

<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateAccountPreferencesRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // يلزم أحدهما مع الآخر لحفظ العرض (كما كان)، ويجوز حفظ `commerce_alerts` وحدها (H3-7).
            'locale'    => ['required_without:commerce_alerts', 'string', Rule::in(['ar', 'en'])],
            'theme'     => ['required_without:commerce_alerts', 'string', Rule::in(['system', 'light', 'dark'])],
            // AWJ v3 theme (Default/Ink/Core) — independent of `theme` above
            // (Light/Dark). Optional so older/other API clients that only send
            // locale+theme keep working; the controller fills the stored default.
            'appTheme'  => ['sometimes', 'string', Rule::in(['default', 'ink', 'core'])],
            // COPS-H3-7: تفضيلات تنبيهات التجارة الشخصية. اختياري؛ الغياب = بلا تغيير. المفاتيح
            // المسموحة مغلقة (`array:enabled`) كي لا يتحول العمود إلى مخزن حر؛ يضيف كل مفتاح لاحق
            // نفسه هنا صراحةً. `enabled` إيقاف شخصي للتنبيه (لا يغيّر صلاحية ولا يستلم أحد ما لا يملكه).
            'commerce_alerts'         => ['sometimes', 'array:enabled'],
            'commerce_alerts.enabled' => ['required_with:commerce_alerts', 'boolean'],
        ];
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateCompanyRequest;
use App\Models\Tenant;
use App\Support\CompanyProfile;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;

/**
 * تحرير ملف الشركة (المستأجر الحالي).
 * تحديث ملف فقط — لا أثر محاسبي (لا قيود).
 */
class CompanyController extends ApiController
{
    public function update(UpdateCompanyRequest $request): JsonResponse
    {
        $tenant = Tenant::findOrFail(app(TenantContext::class)->id());
        $validated = $request->validated();

        $tenant->update(Arr::only($validated, CompanyProfile::TENANT_FIELDS));

        // تمرير النص الفارغ مقصود لمسح حقل العنوان، أما المفتاح الغائب فلا يغيّر
        // القيمة المحفوظة. إزالة الشعار تحتاج إشارة صريحة لأن غياب `logo` يعني
        // الاحتفاظ بالقيمة القائمة. Settings::put يحفظ مفاتيح عقد company فقط.
        $companySettings = Arr::only($validated, CompanyProfile::SETTINGS_FIELDS);
        if ($request->boolean('clear_logo')) {
            $companySettings['logo'] = '';
        }
        Settings::put('company', $companySettings, $tenant);
        $tenant->refresh();

        return response()->json([
            'company' => CompanyProfile::payload($tenant),
        ]);
    }
}

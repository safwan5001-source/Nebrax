<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateCompanyRequest;
use App\Models\Tenant;
use App\Services\Accounting\CompanyCurrencyGuard;
use App\Support\CompanyProfile;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;

/**
 * تحرير ملف الشركة (المستأجر الحالي).
 * تحديث ملف فقط — لا أثر محاسبي (لا قيود).
 * CUR-1: تغيير العملة محروس بعد وجود قيود مرحّلة (`CompanyCurrencyGuard`، 422 `company_currency_locked`).
 */
class CompanyController extends ApiController
{
    public function update(UpdateCompanyRequest $request, CompanyCurrencyGuard $currencyGuard): JsonResponse
    {
        $validated = $request->validated();

        // CUR-1: كل التحديث في معاملة واحدة تقفل صفّ المستأجر (مِرساة الترحيل نفسها) قبل فحص القيود. الرفض يتراجع
        // كاملاً — لا حفظ جزئي لبقية الحقول. `currency` الغائب/الفارغ لا يغيّر سلوك الحفظ، والمطابق للمخزَّن لا يُكتب.
        $tenant = DB::transaction(function () use ($request, $validated, $currencyGuard): Tenant {
            $tenant = Tenant::query()->whereKey(app(TenantContext::class)->id())->lockForUpdate()->firstOrFail();

            $fields = Arr::only($validated, CompanyProfile::TENANT_FIELDS);
            $currency = $currencyGuard->resolve($tenant, $fields['currency'] ?? null);
            unset($fields['currency']);
            if ($currency !== null) {
                $fields['currency'] = $currency;
            }

            $tenant->update($fields);

            // تمرير النص الفارغ مقصود لمسح حقل العنوان، أما المفتاح الغائب فلا يغيّر
            // القيمة المحفوظة. إزالة الشعار تحتاج إشارة صريحة لأن غياب `logo` يعني
            // الاحتفاظ بالقيمة القائمة. Settings::put يحفظ مفاتيح عقد company فقط.
            $companySettings = Arr::only($validated, CompanyProfile::SETTINGS_FIELDS);
            if ($request->boolean('clear_logo')) {
                $companySettings['logo'] = '';
            }
            Settings::put('company', $companySettings, $tenant);

            return $tenant->refresh();
        });

        return response()->json([
            'company' => CompanyProfile::payload($tenant),
        ]);
    }
}

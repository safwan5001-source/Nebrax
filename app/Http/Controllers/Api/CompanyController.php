<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateCompanyRequest;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * تحرير ملف الشركة (المستأجر الحالي): الاسم، الرقم الضريبي، السجل التجاري،
 * العملة، الدولة. تحديث ملف فقط — لا أثر محاسبي (لا قيود).
 */
class CompanyController extends ApiController
{
    public function update(UpdateCompanyRequest $request): JsonResponse
    {
        $tenant = Tenant::findOrFail(app(TenantContext::class)->id());
        $tenant->update($request->validated());

        return response()->json([
            'company' => [
                'name'       => $tenant->name,
                'vat_number' => $tenant->vat_number,
                'cr_number'  => $tenant->cr_number,
                'currency'   => $tenant->currency,
                'country'    => $tenant->country,
            ],
        ]);
    }
}

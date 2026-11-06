<?php

namespace App\Http\Requests;

use App\Support\FuelStaffTemplates;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * FUEL-B3: إسناد قالب/صلاحيات وقود ونطاق محطات لموظف. الصلاحية الحاكمة (`fuel.staff.manage`) في المسار؛ حدود التفويض في `FuelStaffAccessService`.
 * `template`: غائب = بلا تغيير للأساس، `null` = مسح كل صلاحيات الوقود، نص = قالب جديد. `station_ids`: غائب = بلا تغيير، مصفوفة = المحطات الجديدة كاملة.
 */
class UpdateFuelStaffRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'template' => ['sometimes', 'nullable', 'string', Rule::in(array_keys(FuelStaffTemplates::all()))],
            'grant_all_fuel' => ['sometimes', 'boolean'],
            'add_permissions' => ['sometimes', 'array', 'max:200'],
            'add_permissions.*' => ['string', 'max:100'],
            'remove_permissions' => ['sometimes', 'array', 'max:200'],
            'remove_permissions.*' => ['string', 'max:100'],
            'station_ids' => ['sometimes', 'array', 'max:200'],
            'station_ids.*' => ['uuid', 'distinct'],
            'expected_revision' => ['sometimes', 'nullable', 'string', 'max:64'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}

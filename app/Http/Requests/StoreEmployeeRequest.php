<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreEmployeeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return array_merge([
            'branch_id'    => ['nullable', 'uuid'], // مكان العمل (وصفي — لا يعزل)
            'employee_no'  => ['nullable', 'string', 'max:255'],
            'name'         => ['required', 'string', 'max:255'],
            'first_name'   => ['nullable', 'string', 'max:255'],
            'middle_name'  => ['nullable', 'string', 'max:255'],
            'last_name'    => ['nullable', 'string', 'max:255'],
            'national_id'  => ['nullable', 'string', 'max:255'],
            'nationality'  => ['nullable', 'string', 'max:255'],
            'residency_expiry_date' => ['nullable', 'date'],
            'phone'          => ['nullable', 'string', 'max:255'],
            'personal_email' => ['nullable', 'email', 'max:255'],
            'job_title'      => ['nullable', 'string', 'max:255'],
            'department'     => ['nullable', 'string', 'max:255'],
            'employment_type' => ['nullable', Rule::in(['full_time', 'part_time', 'contract', 'temporary'])],
            // ملكية المعرّفين (المستأجر والفرع الصحيح للوردية) تُتحقَّق في المتحكّم.
            'manager_id'   => ['nullable', 'uuid'],
            'shift_id'     => ['nullable', 'uuid'],
            'basic_salary'     => ['required', 'integer', 'min:0'], // هللات
            'allowances'       => ['nullable', 'integer', 'min:0'], // هللات
            'gosi'             => ['nullable', 'integer', 'min:0'], // حصة الموظف (هللات)
            'other_deductions' => ['nullable', 'integer', 'min:0'], // سُلف/أخرى (هللات)
            'hire_date'    => ['nullable', 'date'],
            'is_active'    => ['boolean'],
            'notes'        => ['nullable', 'string'],
        ], self::addressRules());
    }

    /** العنوانان (حالي/دائم) — نمط عنوان `partners` نفسه مكرَّراً بادئتين. */
    public static function addressRules(): array
    {
        $rules = [];
        foreach (['current', 'permanent'] as $prefix) {
            foreach (['address', 'city', 'building_no', 'street', 'district', 'postal_code', 'country'] as $field) {
                $rules["{$prefix}_{$field}"] = ['nullable', 'string', 'max:255'];
            }
        }

        return $rules;
    }
}

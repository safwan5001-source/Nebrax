<?php

namespace App\Http\Requests;

use App\Support\ApplicationCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class ToggleApplicationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $groups = array_values(array_unique(array_map(
            fn (array $application) => $application['group'],
            ApplicationCatalog::all(),
        )));

        return [
            'scope' => ['nullable', 'string', Rule::in(['capability', 'group', 'group_capabilities', 'all_groups'])],
            'application_key' => ['nullable', 'string', Rule::in(ApplicationCatalog::keys())],
            'group_key' => ['nullable', 'string', Rule::in($groups)],
            'reason' => ['nullable', 'string', 'max:500'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator): void {
            $scope = $this->input('scope', 'capability');

            if ($scope === 'capability' && ! $this->filled('application_key')) {
                $validator->errors()->add('application_key', 'مفتاح التطبيق مطلوب.');
            }

            if (in_array($scope, ['group', 'group_capabilities'], true) && ! $this->filled('group_key')) {
                $validator->errors()->add('group_key', 'مفتاح التطبيق الرئيسي مطلوب.');
            }
        }];
    }

    public function messages(): array
    {
        return [
            'application_key.in' => 'مفتاح تطبيق غير معروف.',
            'group_key.in' => 'مفتاح تطبيق رئيسي غير معروف.',
            'scope.in' => 'نطاق إجراء التطبيقات غير معروف.',
        ];
    }
}

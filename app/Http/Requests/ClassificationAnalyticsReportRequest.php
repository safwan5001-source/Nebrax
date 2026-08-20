<?php

namespace App\Http\Requests;

use App\Services\Reporting\ClassificationAnalyticsReportService;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ClassificationAnalyticsReportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'scope' => ['required', Rule::in(ClassificationAnalyticsReportService::SCOPES)],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'branch_id' => ['nullable', 'array'],
            'branch_id.*' => ['uuid'],
            'classification_id' => ['nullable', 'uuid'],
        ];
    }
}

<?php

namespace App\Http\Requests;

use App\Models\AiAction;
use App\Services\AiActionHistoryService;
use App\Services\AiActionRegistry;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use ReflectionClass;

/** IMP-H8-S4a: مرشّحات قائمة سجلّ AI Actions — قائمة بيضاء؛ أي مفتاح آخر (مثل `tenant_id`) مرفوض لا مُتجاهَل. */
class ListAiActionsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        $statuses = array_values(array_filter(
            (new ReflectionClass(AiAction::class))->getConstants(),
            static fn ($value, $name) => str_starts_with((string) $name, 'STATUS_'),
            ARRAY_FILTER_USE_BOTH,
        ));

        return [
            'type' => ['sometimes', 'string', Rule::in(app(AiActionRegistry::class)->types())],
            'status' => ['sometimes', 'string', Rule::in($statuses)],
            'mine' => ['sometimes', 'boolean'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:100000'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.AiActionHistoryService::MAX_PER_PAGE],
            'tenant_id' => ['prohibited'],
            'created_by' => ['prohibited'],
            'branch_id' => ['prohibited'],
        ];
    }
}

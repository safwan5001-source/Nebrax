<?php

namespace App\Http\Requests;

use App\Models\ImportJob;
use App\Services\ImportJobAccess;
use App\Services\ProductImportService;
use App\Support\ProductImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * IMP-H1-S8b — طلب تشغيلة إصلاح فرعية. الأرضية (صلاحية إدارة على الأقل) هنا؛ بوابة **مجال** التشغيلة الأم ونطاق فرعها يفرضهما المتحكّم بعد
 * البحث عنها. الملف والخيارات والمعاينة بقواعد `StoreImportJobRequest` نفسها (المجال يأتي من الأم لا من الطلب).
 */
class StoreImportRepairRequest extends FormRequest
{
    public function authorize(): bool
    {
        app(ImportJobAccess::class)->assertManageAny($this);

        return true;
    }

    public function parent(): ImportJob
    {
        return ImportJob::query()->whereKey((string) $this->route('id'))->firstOrFail();
    }

    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120'],
            'idempotency_key' => ['sometimes', 'nullable', 'string', 'max:191'],
            'preview_id' => ['required_with:preview_hash', 'nullable', 'uuid'],
            'preview_hash' => ['required_with:preview_id', 'nullable', 'string', 'size:64'],
            'options' => ['sometimes', 'nullable', 'array'],
            'options.mode' => ['sometimes', Rule::in([ProductImportService::MODE_CREATE, ProductImportService::MODE_UPDATE, ProductImportService::MODE_UPSERT])],
            'options.blank_policy' => ['sometimes', Rule::in([ProductImportService::BLANK_IGNORE, ProductImportService::BLANK_CLEAR])],
            'options.master_data_policy' => ['sometimes', Rule::in([ProductImportService::MASTER_DATA_ERROR, ProductImportService::MASTER_DATA_TEXT, ProductImportService::MASTER_DATA_CREATE])],
            'options.mapping' => ['sometimes', 'array', 'max:'.ProductImportService::MAX_COLUMNS],
            'options.mapping.*' => ['nullable', 'string', Rule::in(array_merge(ProductImportFields::keys(), ['ignore']))],
        ];
    }

    /** @return array<string, mixed>|null */
    public function creationOptions(): ?array
    {
        $options = $this->input('options');

        return is_array($options) ? $options : null;
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف الإصلاح (CSV أو XLSX) كما نزل من الصفوف الفاشلة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الإصلاح يجب ألا يتجاوز 5 ميغابايت.',
        ];
    }
}

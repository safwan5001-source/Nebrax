<?php

namespace App\Http\Requests;

use App\Services\PartnerImportService;
use App\Support\PartnerImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد الأطراف (IMP-H3-S2). **لا طلب تطبيق متزامن**: التنفيذ يمرّ بالتشغيلة الدائمة المربوطة بمعاينتها فقط
 * (القاعدة 10)، فلا يوجد `apply` هنا. الصلاحية `partners.manage` تُفرض على المسار.
 */
class PartnerImportRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120'],
            'type' => ['required', Rule::in(PartnerImportService::TYPES)],
            'mode' => ['sometimes', Rule::in([PartnerImportService::MODE_CREATE, PartnerImportService::MODE_UPDATE, PartnerImportService::MODE_UPSERT])],
            'blank_policy' => ['sometimes', Rule::in([PartnerImportService::BLANK_IGNORE, PartnerImportService::BLANK_CLEAR])],
            'duplicate_signal_policy' => ['sometimes', Rule::in([PartnerImportService::SIGNAL_ERROR, PartnerImportService::SIGNAL_SKIP, PartnerImportService::SIGNAL_WARN])],
            'mapping' => ['sometimes', 'array', 'max:'.PartnerImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(PartnerImportFields::keys(), ['ignore']))],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'type.required' => 'حدّد نوع الاستيراد: عملاء أو موردين.',
            'type.in' => 'نوع الاستيراد يجب أن يكون عملاء أو موردين.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد الأطراف.',
        ];
    }

    /**
     * خيارات الخدمة كما أُرسلت. المطابقة تصل فهرساً→مفتاحاً، والقيمة `ignore` تعني «لا حقل» فلا تعود المطابقة التلقائية فتربط العمود.
     *
     * @return array<string, mixed>
     */
    public function importOptions(): array
    {
        $options = ['type' => $this->string('type')->toString()];
        foreach (['mode', 'blank_policy', 'duplicate_signal_policy'] as $key) {
            if ($this->has($key)) {
                $options[$key] = $this->string($key)->toString();
            }
        }
        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        return $options;
    }
}

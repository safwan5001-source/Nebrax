<?php

namespace App\Http\Requests;

use App\Models\PartnerStatementReconciliation;
use App\Services\PartnerStatementImportAdapter;
use App\Services\PartnerStatementImportService;
use App\Support\PartnerStatementImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات فحص/معاينة استيراد كشف حساب طرف (IMP-PS-A1). الطرف والدور والفترة والسياسات خيارات مجمَّدة مع المعاينة (لا أعمدة). **لا تطبيق متزامن.**
 * الصلاحية `partner_statements.reconcile` تُفرض على المسار، و`partners.view` + ضوابط رؤية الطرف في الخدمة. مفاتيح النطاق (`tenant_id` …) ممنوعة.
 */
class PartnerStatementImportRequest extends FormRequest
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
            'partner_id' => ['required', 'uuid'],
            'role' => ['required', Rule::in(PartnerStatementReconciliation::ROLES)],
            'period_from' => ['required', 'date_format:Y-m-d'],
            'period_to' => ['required', 'date_format:Y-m-d'],
            'currency' => ['sometimes', 'nullable', 'string', 'max:16'],
            'amount_direction' => ['sometimes', 'nullable', Rule::in(PartnerStatementImportFields::DIRECTIONS)],
            'date_tolerance_days' => ['sometimes', 'integer', 'min:0', 'max:'.PartnerStatementImportService::MAX_DATE_TOLERANCE_DAYS],
            'amount_tolerance_minor' => ['sometimes', 'integer', 'min:0', 'max:'.PartnerStatementImportService::MAX_AMOUNT_TOLERANCE_MINOR],
            'branch_id' => ['sometimes', 'nullable', 'uuid'],
            'mapping' => ['sometimes', 'array', 'max:'.PartnerStatementImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(PartnerStatementImportFields::keys(), ['ignore']))],
            'tenant_id' => ['prohibited'],
            'created_by' => ['prohibited'],
            'status' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'partner_id.required' => 'اختر الطرف.',
            'partner_id.uuid' => 'معرّف الطرف غير صالح.',
            'role.required' => 'اختر الدور: عميل أو مورّد.',
            'period_from.required' => 'بداية الفترة مطلوبة.',
            'period_to.required' => 'نهاية الفترة مطلوبة.',
            'period_from.date_format' => 'بداية الفترة بصيغة YYYY-MM-DD.',
            'period_to.date_format' => 'نهاية الفترة بصيغة YYYY-MM-DD.',
            'amount_direction.in' => 'اتجاه المبلغ غير صالح.',
            'date_tolerance_days.max' => 'فرق التاريخ المسموح لا يتجاوز '.PartnerStatementImportService::MAX_DATE_TOLERANCE_DAYS.' يوماً.',
            'amount_tolerance_minor.integer' => 'فرق المبلغ المسموح عدد صحيح من الهللات (لا نسبة مئوية).',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد هذا الاستيراد.',
        ];
    }

    /** الخيارات القانونية المجمَّدة مع بصمة المعاينة. @return array<string, mixed> */
    public function importOptions(): array
    {
        $raw = [
            'partner_id' => $this->string('partner_id')->toString(),
            'role' => $this->string('role')->toString(),
            'period_from' => $this->string('period_from')->toString(),
            'period_to' => $this->string('period_to')->toString(),
            'currency' => $this->input('currency'),
            'amount_direction' => $this->input('amount_direction'),
            'date_tolerance_days' => $this->input('date_tolerance_days', PartnerStatementImportService::DEFAULT_DATE_TOLERANCE_DAYS),
            'amount_tolerance_minor' => $this->input('amount_tolerance_minor', PartnerStatementImportService::DEFAULT_AMOUNT_TOLERANCE_MINOR),
            'branch_id' => $this->input('branch_id'),
        ];
        if ($this->has('mapping')) {
            $raw['mapping'] = (array) $this->input('mapping', []);
        }

        return app(PartnerStatementImportAdapter::class)->canonicalOptions($raw);
    }
}

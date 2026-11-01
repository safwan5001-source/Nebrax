<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** فحص أعمدة كشف الطرف (IMP-PS-A1): الملف وحده — لا طرف ولا فترة، فلا يُقرأ شيء من بيانات الأطراف. الصلاحية `partner_statements.reconcile` على المسار. */
class PartnerStatementInspectRequest extends FormRequest
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
            'tenant_id' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
        ];
    }
}

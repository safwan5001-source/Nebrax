<?php

namespace App\Http\Requests;

use App\Services\ImportJobAccess;
use App\Support\ImportJobDomain;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreImportJobRequest extends FormRequest
{
    /**
     * IMP-H1-S1 — صلاحية الإدارة + قدرة **مجال** التشغيلة، قبل أي فحص لمحتوى الملف (يجري `authorize` قبل
     * التحقق). مجالٌ غير معروف يُحاسَب على بوابات كتالوج المنتجات (سلوك المسار القديم نفسه) ثم يفشل
     * التحقق 422 — فلا يتحوّل 403 إلى 422 لمن لا يملك أي صلاحية.
     */
    public function authorize(): bool
    {
        $domain = $this->input('domain');
        // غير نصّي (`domain[]=x`) أو غير معروف: يُحاسَب على بوابات المنتجات ثم يفشل التحقق 422 — لا 500.
        $known = is_string($domain) && in_array($domain, ImportJobDomain::values(), true) ? $domain : ImportJobDomain::PRODUCT_CATALOG;
        app(ImportJobAccess::class)->assertManage($this, $known);

        return true;
    }

    public function rules(): array
    {
        return [
            // نفس قواعد `ImportProductsRequest` حرفياً — سقف حجم وامتداد موحّد
            // عبر كل أسطح الاستيراد. `mimes` سقفٌ عامٌّ يشمل امتدادات كل
            // المجالات معاً؛ التضييق لكل مجال (XLSX حصراً لـ`product_workbook`،
            // مطابقاً `ProductWorkbookImportRequest` حرفياً) في الإغلاق أدناه.
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120', function ($attribute, $value, $fail) {
                $domain = $this->input('domain');
                $domain = is_string($domain) ? $domain : ''; // `domain[]=x` يفشل بـ422 (قاعدة `in`) لا 500.
                $extension = strtolower((string) $value->getClientOriginalExtension());
                if ($domain === ImportJobDomain::PRODUCT_WORKBOOK && $extension !== 'xlsx') {
                    $fail('مصنّف Products/Barcodes/Unit Prices يجب أن يكون بصيغة XLSX.');
                }
            }],
            'domain' => ['required', Rule::in(ImportJobDomain::values())],
            'media_archive' => ['sometimes', 'nullable', 'file', 'mimes:zip', 'max:51200', function ($attribute, $value, $fail) {
                if ($this->input('domain') !== ImportJobDomain::PRODUCT_CATALOG) {
                    $fail('أرشيف صور المنتجات متاح لاستيراد كتالوج المنتجات فقط.');
                }
            }],
            'idempotency_key' => ['sometimes', 'nullable', 'string', 'max:191'],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'domain.required' => 'حدّد مجال الاستيراد.',
            'domain.in' => 'مجال الاستيراد غير مدعوم.',
            'media_archive.mimes' => 'أرشيف الصور يجب أن يكون ملف ZIP صالحاً.',
            'media_archive.max' => 'حجم أرشيف الصور يجب ألا يتجاوز 50 ميغابايت.',
        ];
    }
}

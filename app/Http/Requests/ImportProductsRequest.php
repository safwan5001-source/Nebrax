<?php

namespace App\Http\Requests;

use App\Services\ProductImportService;
use App\Support\ProductImportFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * مدخلات استيراد المنتجات (فحص · معاينة · تطبيق).
 *
 * **التوافق الخلفي مقصود:** عميل V1 يرسل `{file, mode}` فقط، وكل ما أُضيف
 * اختياري بافتراضٍ يعيد سلوك V1 حرفياً — سياسة الفراغ «تجاهل»، وسياسة
 * البيانات الأساسية «طابق أو احفظ نصّاً»، والمطابقة تلقائية من الترويسات.
 */
class ImportProductsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // `mimes` يعتمد على الامتداد وعلى نوع MIME المكتشَف؛ ملفات Excel
            // تصل أحياناً بـ`application/zip` فيُذكر الامتدادان معاً.
            'file' => ['required', 'file', 'mimes:csv,txt,xlsx', 'max:5120'],
            'mode' => ['sometimes', Rule::in([
                ProductImportService::MODE_CREATE,
                ProductImportService::MODE_UPDATE,
                ProductImportService::MODE_UPSERT,
            ])],
            'blank_policy' => ['sometimes', Rule::in([
                ProductImportService::BLANK_IGNORE,
                ProductImportService::BLANK_CLEAR,
            ])],
            'master_data_policy' => ['sometimes', Rule::in([
                ProductImportService::MASTER_DATA_ERROR,
                ProductImportService::MASTER_DATA_TEXT,
                ProductImportService::MASTER_DATA_CREATE,
            ])],
            // مطابقة الأعمدة: فهرس العمود في الملف → مفتاح حقل نبراكس.
            'mapping' => ['sometimes', 'array', 'max:'.ProductImportService::MAX_COLUMNS],
            'mapping.*' => ['nullable', 'string', Rule::in(array_merge(ProductImportFields::keys(), ['ignore']))],
            // التطبيق الدفعي اختياري؛ غيابه يبقي عقد V1/V2 القديم كما هو.
            'batch_offset' => ['sometimes', 'integer', 'min:0', 'max:'.ProductImportService::MAX_ROWS],
            'batch_size' => ['sometimes', 'integer', 'min:1', 'max:'.ProductImportService::APPLY_BATCH_SIZE],
        ];
    }

    public function messages(): array
    {
        return [
            'file.required' => 'اختر ملف CSV أو XLSX قبل المتابعة.',
            'file.mimes' => 'ارفع ملف CSV بترميز UTF-8 أو ملف Excel بصيغة XLSX.',
            'file.max' => 'حجم ملف الاستيراد يجب ألا يتجاوز 5 ميغابايت.',
            'mode.in' => 'اختر وضع الإنشاء أو التحديث أو الدمج.',
            'blank_policy.in' => 'سياسة القيم الفارغة غير صالحة.',
            'master_data_policy.in' => 'سياسة البيانات الأساسية غير صالحة.',
            'mapping.*.in' => 'أحد الأعمدة مربوط بحقل غير معروف في عقد استيراد المنتجات.',
        ];
    }

    /**
     * خيارات التشغيل كما تستهلكها الخدمة.
     *
     * @return array<string, mixed>
     */
    public function importOptions(): array
    {
        $options = [
            'mode' => $this->string('mode', ProductImportService::MODE_CREATE)->toString(),
            'blank_policy' => $this->string('blank_policy', ProductImportService::BLANK_IGNORE)->toString(),
            'master_data_policy' => $this->string('master_data_policy', ProductImportService::MASTER_DATA_TEXT)->toString(),
        ];

        if ($this->has('mapping')) {
            $options['mapping'] = (array) $this->input('mapping', []);
        }

        if ($this->has('batch_offset')) {
            $options['batch_offset'] = (int) $this->input('batch_offset');
        }
        if ($this->has('batch_size')) {
            $options['batch_size'] = (int) $this->input('batch_size');
        }

        return $options;
    }
}

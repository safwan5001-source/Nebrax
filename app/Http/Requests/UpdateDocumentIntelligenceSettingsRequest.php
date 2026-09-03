<?php

namespace App\Http\Requests;

use App\Support\DocumentIntelligence;
use App\Support\DocumentTypeCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * تحديث إعدادات الذكاء المستندي — المفهومان مستقلّان، وكلاهما اختياري في
 * الطلب (تحديث جزئي كبقية شاشات الإعدادات). القيمة غير المرسلة تبقى كما هي.
 */
class UpdateDocumentIntelligenceSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            // المعالجة الذكية — قرار مستقلّ عن الاحتفاظ.
            'processing_enabled' => ['sometimes', 'boolean'],
            'allowed_document_types' => ['sometimes', 'array'],
            'allowed_document_types.*' => ['string', Rule::in(DocumentTypeCatalog::all())],
            // الاحتفاظ بالأصل — قرار مستقلّ عن المعالجة الذكية.
            'retention_mode' => ['sometimes', 'string', Rule::in(DocumentIntelligence::RETENTION_MODES)],
        ];
    }

    public function messages(): array
    {
        return [
            'allowed_document_types.*.in' => 'أحد أنواع المستندات المحددة غير مدعوم.',
            'retention_mode.in' => 'سياسة الاحتفاظ بالأصل المحددة غير معروفة.',
        ];
    }
}

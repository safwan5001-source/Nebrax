<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateDocumentIntelligenceSettingsRequest;
use App\Services\DocumentCenter\DocumentIntelligencePolicy;
use App\Support\DocumentIntelligence;
use App\Support\DocumentTypeCatalog;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات الذكاء المستندي — مورد مفرد لكل مستأجر. يحكم مفهومَين **مستقلّين**:
 *
 *  1) المعالجة الذكية: `processing_enabled` + `allowed_document_types`.
 *  2) الاحتفاظ بالأصل: `retention_mode` (أربع دلالات متمايزة).
 *
 *  تفعيل الذكاء لا يفرض الاحتفاظ ولا يمنعه — القيمتان لا تشتقّ إحداهما من
 *  الأخرى. القرار الفعّال يُقرأ عبر `DocumentIntelligencePolicy` كي تراه
 *  الخدمات نفسه الذي تراه الواجهة.
 *
 *  الحارس صلاحية `documents.center.settings` (للمالك/المدير). الإعداد تفضيلٌ
 *  خامل في `tenants.settings` لا يبدأ اتصالاً خارجياً، فلا يُقيَّد بتفعيل
 *  المنتج التجاري؛ إنفاذ قدرات المركز التشغيلية يبقى على مساراتها.
 */
class DocumentIntelligenceSettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->payload()]);
    }

    public function update(UpdateDocumentIntelligenceSettingsRequest $request): JsonResponse
    {
        Settings::put(DocumentIntelligence::SETTINGS_GROUP, $request->validated());

        return response()->json(['data' => $this->payload()]);
    }

    /** @return array<string, mixed> */
    private function payload(): array
    {
        return [
            'settings' => DocumentIntelligencePolicy::forTenant()->toArray(),
            // الخيارات المتاحة للواجهة — لا تصنيفة موازية، بل نفس المصدر.
            'available_document_types' => DocumentTypeCatalog::all(),
            'available_retention_modes' => DocumentIntelligence::RETENTION_MODES,
        ];
    }
}

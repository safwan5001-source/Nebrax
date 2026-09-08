<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateDocumentDisplaySettingsRequest;
use App\Support\PrintTemplateContract;
use App\Support\Settings;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات عرض المستندات لكل مستأجر — مورد مفرد.
 *
 * V1 يحكم مفتاحاً واحداً: `default_language` — لغة العرض الافتراضية للمسودات
 * الجديدة. لا يمسّ مستنداً قائماً (مسودة أو مرحّلاً)، ولا يغيّر ZATCA/QR/
 * الأرقام/المحاسبة — قرار عرض بحت مستقل عن UI locale واختيار التصميم.
 *
 * الحارس صلاحية `documents.settings.manage` (مالك/مدير)، وتُقرأ التقييمات
 * الفعلية عبر `PrintTemplateContract::resolveEffectiveLanguage` نفسها في
 * كل من الخدمة والعميل، فلا يخترع مسار جديد سلسلة سقوط موازية.
 */
class DocumentDisplaySettingsController extends ApiController
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->payload()]);
    }

    public function update(UpdateDocumentDisplaySettingsRequest $request): JsonResponse
    {
        Settings::put('documents', $request->validated());

        return response()->json(['data' => $this->payload()]);
    }

    /** @return array<string, mixed> */
    private function payload(): array
    {
        return [
            'default_language' => Settings::get('documents', 'default_language'),
            'available_languages' => PrintTemplateContract::DOCUMENT_LANGUAGES,
        ];
    }
}

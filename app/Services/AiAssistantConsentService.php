<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\User;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantDenied;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * تغيير موافقة المؤسسة على المساعد الذكي (AI-03) — مسار الكتابة الوحيد لمجموعة `ai_assistant`.
 *
 * - **ذرّي:** معاملة واحدة بقفل صفّ المستأجر، فتحديثان متزامنان لا يدوسان أحدهما الآخر، ولا يُعدَّل
 *   إلا مفتاحا المجموعة المعروفان (`Settings::put` يُسقط المجهول).
 * - **تدقيق وصفي إلزامي في المعاملة نفسها:** فشل كتابته يُجهض التغيير كله (لا موافقة بلا أثر).
 * - **المنح مقيَّد، السحب حرّ:** تفعيل المساعد أو إضافة فئة يتطلب تفعيل المنصة وإقراراً صريحاً بإشعار
 *   الخصوصية؛ أما التعطيل وسحب فئة فمتاحان دائماً ودون إقرار.
 * - **التعطيل سحبٌ كامل:** `enabled=false` يمسح كل الفئات، فإعادة التفعيل تستلزم موافقةً جديدة صريحة.
 * - فئة مجهولة أو غير متاحة (`document_projected_text` حتى AI-04) تُرفض ولا تُخزَّن.
 * - **لا علاقة** بـ`allow_document_sending` ولا بمجموعة `document_intelligence`: موافقة مركز المستندات
 *   لا تمنح ولا تسحب شيئاً هنا.
 * - يسري التغيير في الطلب التالي مباشرةً: السياسة تقرأ المستأجر طازجاً من القاعدة عند كل طلب وكل أداة.
 */
class AiAssistantConsentService
{
    public function __construct(
        private readonly AiAssistantPolicy $policy,
        private readonly AiAuditRecorder $audit,
        private readonly AiAssistantStatusService $status,
    ) {}

    /**
     * @param  list<string>  $categories
     * @return array<string,mixed> الحالة الجديدة كما تعيدها `AiAssistantStatusService`.
     * @throws AiAssistantDenied
     */
    public function update(User $actor, bool $enabled, array $categories, bool $acknowledged): array
    {
        $requested = $enabled ? array_values(array_unique($categories)) : [];
        foreach ($requested as $category) {
            if (! is_string($category) || ! AiAssistantDataCategory::isAvailable($category)) {
                throw AiAssistantDenied::for('data_category_unavailable');
            }
        }

        DB::transaction(function () use ($actor, $enabled, $requested, $acknowledged): void {
            $tenant = Tenant::query()->whereKey($actor->tenant_id)->lockForUpdate()->firstOrFail();
            $current = Settings::group('ai_assistant', $tenant);
            $wasEnabled = ($current['enabled'] ?? false) === true;
            $before = AiAssistantDataCategory::sanitize($current['consented_categories'] ?? []);

            $granted = array_values(array_diff($requested, $before));
            $revoked = array_values(array_diff($before, $requested));
            if ($wasEnabled === $enabled && $granted === [] && $revoked === []) {
                return; // لا تغيير فعلي: لا كتابة ولا تدقيق.
            }

            if ((! $wasEnabled && $enabled) || $granted !== []) {
                if (! $this->policy->platformEnabled()) {
                    throw AiAssistantDenied::for('platform_disabled');
                }
                if (! $acknowledged) {
                    throw AiAssistantDenied::for('acknowledgement_required');
                }
            }

            Settings::put('ai_assistant', ['enabled' => $enabled, 'consented_categories' => $requested], $tenant);

            $this->audit->record(
                (string) Str::uuid(),
                (string) $tenant->getKey(),
                (string) $actor->getKey(),
                'consent.updated',
                'allowed',
                'ok',
                ['meta' => ['consent_enabled' => $enabled, 'categories_granted' => $granted, 'categories_revoked' => $revoked]],
                required: true,
            );
        });

        return $this->status->for($actor);
    }
}

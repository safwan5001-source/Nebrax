<?php

namespace App\Services;

use App\Models\Tenant;
use App\Models\User;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use App\Support\AiAssistantDataCategory;
use App\Support\AiAssistantPricing;
use App\Support\Rbac;
use App\Support\Settings;

/**
 * حالة المساعد الذكي كما يراها مستخدم بعينه (AI-03) — **قراءة فقط** ومصدرها الخادم وحده.
 *
 * تجيب الواجهة عن «ماذا أعرض؟» دون أن تخمّن ودون أن تُجري طلباً مالياً أو طلب محادثة لتكتشف الرفض. لا تُغني
 * عن الإنفاذ: كل طلب فعلي يعيد التفويض الكامل بفاعل طازج (`AiAssistantPolicy`)، وهذه مجرد لقطة للعرض.
 *
 * لا تكشف شيئاً من إعدادات المنصة غير علم التفعيل: لا مفاتيح، لا أسعار، لا ميزانيات، لا اسم مزوّد حقيقي.
 * الحالتان `chat` و`financial` بالأولوية نفسها التي يطبّقها الخادم عند الرفض تقريباً، وتُحسبان للمستخدم الحالي:
 *   ready | permission_denied | platform_disabled | tenant_disabled | consent_required |
 *   provider_unavailable (محادثة) | currency_unsupported (مالية)
 */
class AiAssistantStatusService
{
    public function __construct(private readonly AiAssistantPolicy $policy) {}

    /** @return array<string,mixed> */
    public function for(User $user): array
    {
        $tenant = Tenant::query()->findOrFail($user->tenant_id);
        $settings = Settings::group('ai_assistant', $tenant);
        $consented = AiAssistantDataCategory::sanitize($settings['consented_categories'] ?? []);
        $tenantEnabled = ($settings['enabled'] ?? false) === true;
        $platform = $this->policy->platformEnabled();
        $external = $this->externalProviderConfigured();
        // `mock` | `external` (AI-07) | `unavailable`. الخارجي «متاح» فقط إن اجتاز المزوّد كل شروط المنصة وكان سعره معرَّفاً.
        $providerMode = match (true) {
            config('ai_assistant.provider') === 'mock' => 'mock',
            $external && $this->externalReady() => 'external',
            default => 'unavailable',
        };
        $providerAvailable = $providerMode !== 'unavailable';
        $externalSettings = Settings::group('ai_assistant_external', $tenant);
        $externalAck = ! $external || ($externalSettings['acknowledged'] ?? false) === true;
        $documentsAck = ($externalSettings['documents_acknowledged'] ?? false) === true;

        $can = fn (string $permission): bool => Rbac::allows((string) $user->role, $permission);
        $use = $can(AiAssistantPolicy::PERMISSION);

        $common = match (true) {
            ! $use => 'permission_denied',
            ! $platform => 'platform_disabled',
            ! $tenantEnabled => 'tenant_disabled',
            default => null,
        };

        $chat = $common ?? match (true) {
            ! $providerAvailable => 'provider_unavailable',
            ! in_array(AiAssistantDataCategory::ASSISTANT_MESSAGES, $consented, true) => 'consent_required',
            ! $externalAck => 'external_provider_not_acknowledged',
            default => 'ready',
        };

        $financial = match (true) {
            $common !== null => $common,
            ! $can('reports.view') => 'permission_denied',
            ! in_array(AiAssistantDataCategory::FINANCIAL_SUMMARY, $consented, true) => 'consent_required',
            strtoupper((string) $tenant->currency) !== AiFinanceReportTool::CURRENCY => 'currency_unsupported',
            default => 'ready',
        };

        // AI-04: قراءة مستند مُسقَط. حالات إضافية صادقة: الفئة غير متاحة على المنصة، أو قدرة مركز المستندات غير مستحقة.
        $document = match (true) {
            $common !== null => $common,
            ! $can('documents.center.view') => 'permission_denied',
            ! AiAssistantDataCategory::isAvailable(AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT) => 'category_unavailable',
            $this->documentCenterDenied($tenant, $can('documents.center.view')) => 'document_center_unavailable',
            ! in_array(AiAssistantDataCategory::DOCUMENT_PROJECTED_TEXT, $consented, true) => 'consent_required',
            default => 'ready',
        };

        // AI-07ب: «اسأل عن هذا المستند» عبر المزوّد الخارجي — حالة مستقلة عن القراءة المحلية الصريحة (`document`) التي لا تُرسل شيئاً.
        $documentAsk = match (true) {
            $document !== 'ready' => $document,
            $providerMode !== 'external' => 'provider_unavailable',
            config('ai_assistant.documents.external_send_enabled') !== true => 'external_documents_unavailable',
            ! $externalAck => 'external_provider_not_acknowledged',
            ! $documentsAck => 'external_documents_not_acknowledged',
            default => 'ready',
        };

        return [
            'platform_enabled' => $platform,
            // `mock`: ردود تجريبية حتمية بلا اتصال. `external` (AI-07): يُسمّى المزوّد للمستخدم لأن الموافقة المستنيرة تتطلب ذلك.
            'provider_mode' => $providerMode,
            'provider_label' => $providerMode === 'external' ? 'anthropic' : null,
            'tenant' => [
                'enabled' => $tenantEnabled,
                'consented_categories' => $consented,
            ] + ($external ? ['external_acknowledged' => $externalAck, 'external_documents_acknowledged' => $documentsAck && $externalAck] : []),
            'categories' => array_map(static fn (string $key): array => [
                'key' => $key,
                'available' => AiAssistantDataCategory::isAvailable($key),
                'consented' => in_array($key, $consented, true),
            ], AiAssistantDataCategory::ALL),
            'abilities' => [
                'use' => $use,
                'manage_consent' => $can('ai.consent.manage'),
                'view_audit' => $can('ai.audit.view'),
                'partner_detail' => $can('partners.view'),
                'document_read' => $can('documents.center.view'),
            ],
            'chat' => $chat,
            'financial' => $financial,
            'financial_tools' => ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging'],
            'document' => $document,
            'document_ask' => $documentAsk,
            'document_tools' => [AiDocumentProjectionTool::NAME],
            // «اليوم» بتوقيت المؤسسة: الواجهة لا تخمّن منطقتها الزمنية فتقترح تاريخاً مستقبلياً يرفضه الخادم.
            'clock' => $this->clock($tenant),
        ];
    }

    /** هل المزوّد المضبوط على المنصة خارجي (يتطلب إقراراً وجاهزية)؟ لا يكشف أي إعداد. */
    public function externalProviderConfigured(): bool
    {
        return config('ai_assistant.provider') === 'anthropic';
    }

    private function externalReady(): bool
    {
        try {
            $provider = app(AnthropicAssistantProvider::class);
            $provider->assertReady();

            return AiAssistantPricing::profile($provider->name(), $provider->model()) !== null;
        } catch (\Throwable) {
            return false;
        }
    }

    private function documentCenterDenied(Tenant $tenant, bool $rbac): bool
    {
        return app(ApplicationAccessDecision::class)
            ->decide($tenant, 'document_center.core', ApplicationOperationClass::READ, $rbac)
            ->level === ApplicationAccessLevel::DENIED;
    }

    /** @return array{timezone:string, today:string} */
    private function clock(Tenant $tenant): array
    {
        $zone = (string) ($tenant->timezone ?: 'Asia/Riyadh');
        if (! in_array($zone, timezone_identifiers_list(), true)) {
            $zone = 'Asia/Riyadh';
        }

        return ['timezone' => $zone, 'today' => now($zone)->format('Y-m-d')];
    }
}

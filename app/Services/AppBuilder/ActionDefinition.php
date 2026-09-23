<?php

namespace App\Services\AppBuilder;

/**
 * البيان الوصفي الكامل لنوع إجراء واحد — يغذّي Inspector المستقبلي (نموذج
 * ضبط مُدخلات الإجراء) ويوثّق الفجوة الصادقة بين "مدعوم للفكّ والتحقّق"
 * (`decodeAction`) و"له أثر تجاري فعلي" (`ActionHandler` اليوم هو
 * `NoopActionHandler` فقط — MOBILE-RUNTIME-4/5 لم يُبنَيا). `dispatchStatus`
 * يمنع Inspector مستقبلاً من الإيحاء بأن اختيار `addToCart` مثلاً يُنفّذ شيئاً
 * تجارياً فعلياً اليوم.
 */
final class ActionDefinition
{
    public const DISPATCH_PROVEN_NOOP = 'provenNoop';

    /**
     * @param  array<int, ActionParamDefinition>  $params
     */
    public function __construct(
        public readonly string $type,
        public readonly int $version,
        public readonly string $riskClass,
        public readonly array $params,
        public readonly string $dispatchStatus,
        public readonly string $notes,
    ) {}
}

<?php

namespace App\Services\AppBuilder;

/**
 * وصف مُدخَل واحد ضمن `action.params` لنوع إجراء معيّن — مطابقٌ حرفياً لتحقّق
 * `decodeAction()` في `mobile/lib/actions/app_action.dart` (لا تحقّق أوسع أو
 * أضيق منه): كل قيد هنا (إلزامي/اختياري/قابل للقيمة null/حد أدنى) يقابل شرط
 * `if` فعلياً في تلك الدالة.
 */
final class ActionParamDefinition
{
    public function __construct(
        public readonly string $key,
        public readonly string $type,
        public readonly bool $required,
        public readonly Label $label,
        public readonly bool $nullable = false,
        public readonly mixed $default = null,
        public readonly ?int $minValue = null,
    ) {}
}

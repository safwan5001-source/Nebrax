<?php

namespace App\Services\AppBuilder;

/**
 * تسمية بشرية ثنائية اللغة لمعرّف مخطط داخلي (نوع مكوّن، نوع إجراء، مفتاح
 * خاصية/معامل) — `APP-BUILDER-21`. **لا تُغيّر أي معرّف مخطط داخلي** (`type`،
 * `key`، إلخ تبقى كما هي حرفياً في المخطط/العقد الحقيقي) — هذا الصنف وصفيٌّ
 * بحت يغذّي واجهة التاجر (Inspector/Layers/Canvas) فقط، تماماً كطبيعة
 * `ComponentDefinition::$notes` اليوم.
 */
final class Label
{
    public function __construct(
        public readonly string $ar,
        public readonly string $en,
    ) {}
}

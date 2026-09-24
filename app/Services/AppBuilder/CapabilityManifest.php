<?php

namespace App\Services\AppBuilder;

/**
 * ما يستطيع بناء تشغيل معيّن تنفيذه فعلياً — مطابقٌ لـ
 * `mobile/lib/schema/capability_manifest.dart`. يُنمذِج **دليل** بناء
 * التشغيل، لا **متطلبات** المخطط (تلك في المخطط نفسه) —
 * `CompatibilityResolver` يقارن الاثنين.
 *
 * V1 (APP-BUILDER-2): منصّة واحدة فقط تُستعمَل للتحقّق الخلفي —
 * `RuntimeCapabilities`'s الحالية مطابقة لكلا iOS/Android حرفياً (بلا تفرّع
 * منصّات بعد، كما يوثّق `capability_manifest.dart` نفسه)، فالتحقق وقت النشر
 * يستعمل نسخة واحدة `current()` لا نسختين. تفرّع المنصّات الحقيقي (لو ظهر
 * لاحقاً) يبقى قراراً منفصلاً لا يخترعه هذا الصنف.
 */
final class CapabilityManifest
{
    /**
     * @param  array<string, int>  $components
     * @param  array<string, int>  $actions
     * @param  array<string, int>  $nativeCapabilities
     * @param  array<string, int>  $dataResources  `APP-BUILDER-14` (`ADR-01`) — ما يستهلكه Flutter Runtime المُثبَت فعلياً من `DataResourceRegistry`؛ فارغ حتى `APP-BUILDER-17`، انظر `RuntimeCapabilities::DATA_RESOURCES`.
     */
    public function __construct(
        public readonly SchemaVersion $runtimeVersion,
        public readonly SchemaVersion $minSupportedSchemaVersion,
        public readonly SchemaVersion $maxSupportedSchemaVersion,
        public readonly array $components,
        public readonly array $actions,
        public readonly array $nativeCapabilities = [],
        public readonly array $dataResources = [],
    ) {}

    /** بناء التشغيل الحالي المُثبَت فعلياً — المرجع الوحيد لكود الإنتاج. */
    public static function current(): self
    {
        return new self(
            runtimeVersion: new SchemaVersion(1, 0, 0),
            minSupportedSchemaVersion: new SchemaVersion(1, 0, 0),
            maxSupportedSchemaVersion: new SchemaVersion(1, 0, 0),
            components: RuntimeCapabilities::COMPONENTS,
            actions: RuntimeCapabilities::ACTIONS,
            nativeCapabilities: RuntimeCapabilities::NATIVE_CAPABILITIES,
            dataResources: RuntimeCapabilities::DATA_RESOURCES,
        );
    }

    public function componentVersion(string $type): ?int
    {
        return $this->components[$type] ?? null;
    }

    public function actionVersion(string $type): ?int
    {
        return $this->actions[$type] ?? null;
    }

    /** `APP-BUILDER-14` — يوازي `componentVersion()`/`actionVersion()` لفضاء موارد البيانات. */
    public function resourceVersion(string $id): ?int
    {
        return $this->dataResources[$id] ?? null;
    }

    /**
     * مفتاح `requiredCapabilities` قد يسمّي مكوّناً أو إجراءً أو قدرة أصلية أو
     * مورد بيانات — يطابق `CapabilityManifest.namedCapabilityVersion` في Dart
     * حرفياً (نفس عدم التمييز المتعمَّد بين الفضاءات).
     */
    public function namedCapabilityVersion(string $key): ?int
    {
        return $this->actions[$key] ?? $this->components[$key] ?? $this->nativeCapabilities[$key] ?? $this->dataResources[$key] ?? null;
    }
}

<?php

namespace App\Services\AppBuilder;

use InvalidArgumentException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  أجيال Runtime المعروفة — AD-02 (S05b)
 * ═══════════════════════════════════════════════════════════════
 *
 * سجلّ مرتَّب تصاعدياً بأجيال التشغيل التي تعرفها المنصة، لكل جيل `CapabilityManifest`. الجهاز يعلن جيله بترويسة
 * `X-Runtime-Version` فيُخدَم **أعلى نسخة منشورة متوافقة مع جيله** (لا «الأحدث نشراً» أيّاً كانت).
 *
 * قواعد الاختيار (تطابق AD-02):
 *  - جيل الجهاز = **أعلى جيل معروف لا يتجاوز** الإصدار المعلَن (جهاز أحدث من كل ما نعرف ⇒ أعلى جيل معروف).
 *  - ترويسة غائبة/تالفة/أقدم من كل جيل ⇒ **أقدم جيل معروف** (الأجهزة القديمة بلا ترويسة تُعامَل كـ1.0.0) — لا الأحدث أبداً.
 *  - الإعلان لا يمنح صلاحية: يحدّد فقط أي نسخ المستأجر **نفسه** يتلقّاها الجهاز، والجهاز يتحقق محلياً بفشل مغلق على أي حال.
 *
 * اليوم جيل واحد (1.0.0) فسلوك الإنتاج مطابق لما قبل الشريحة؛ إضافة جيل = إضافة manifest هنا مع اختبارات «أرشيف نسخ».
 */
final class RuntimeGenerations
{
    /** @var list<CapabilityManifest> */
    private array $manifests;

    /**
     * @param  list<CapabilityManifest>  $manifests  بأي ترتيب؛ يُرتَّب تصاعدياً بـ`runtimeVersion`
     *
     * @throws InvalidArgumentException مجموعة فارغة أو إصدار مكرَّر
     */
    public function __construct(array $manifests)
    {
        if ($manifests === []) {
            throw new InvalidArgumentException('سجل أجيال Runtime لا يجوز أن يكون فارغاً.');
        }
        usort($manifests, fn (CapabilityManifest $a, CapabilityManifest $b) => $a->runtimeVersion->lessThan($b->runtimeVersion) ? -1 : ($a->runtimeVersion->greaterThan($b->runtimeVersion) ? 1 : 0));
        for ($i = 1; $i < count($manifests); $i++) {
            if ((string) $manifests[$i]->runtimeVersion === (string) $manifests[$i - 1]->runtimeVersion) {
                throw new InvalidArgumentException("جيل Runtime مكرَّر: {$manifests[$i]->runtimeVersion}.");
            }
        }
        $this->manifests = array_values($manifests);
    }

    /** الأجيال الإنتاجية المعروفة: 1.0.0 والجيل 1.1.0 (غلاف التنقل، AD-04 / S09a). */
    public static function current(): self
    {
        return new self([CapabilityManifest::current(), CapabilityManifest::v110(), CapabilityManifest::v120()]);
    }

    /** @return list<CapabilityManifest> تصاعدياً */
    public function all(): array
    {
        return $this->manifests;
    }

    public function oldest(): CapabilityManifest
    {
        return $this->manifests[0];
    }

    /** جيل الجهاز من قيمة الترويسة الخام (null/تالف ⇒ الأقدم). صيغة `x.y.z` أرقام فقط وبطول معقول. */
    public function forRuntime(?string $header): CapabilityManifest
    {
        $version = ($header !== null && strlen($header) <= 32 && preg_match('/^\d{1,6}\.\d{1,6}\.\d{1,6}$/', $header) === 1)
            ? SchemaVersion::tryParse($header)
            : null;
        if ($version === null) {
            return $this->oldest();
        }

        $match = $this->oldest();
        foreach ($this->manifests as $manifest) {
            if ($manifest->runtimeVersion->greaterThan($version)) {
                break;
            }
            $match = $manifest;
        }

        return $match;
    }

    /**
     * أقدم جيل معروف يستطيع عرض [schema] (أي «`min_runtime` الفعلي» للتجربة)، أو null إن لم يرندرها أي جيل.
     * يُستدعى بعد `AppSchemaParser::validate()` (المحلل يفترض مخططاً صالحاً).
     *
     * @param  array<string, mixed>  $schema
     */
    public function lowestRendering(array $schema, CompatibilityResolver $resolver): ?CapabilityManifest
    {
        foreach ($this->manifests as $manifest) {
            if ($resolver->resolve($schema, $manifest)->compatible) {
                return $manifest;
            }
        }

        return null;
    }
}

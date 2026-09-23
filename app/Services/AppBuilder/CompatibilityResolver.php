<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  محلِّل التوافق — مطابقٌ لـ mobile/lib/schema/compatibility.dart
 * ═══════════════════════════════════════════════════════════════
 *
 * دالة نقية: نفس المخطط + نفس البيان يُنتجان دوماً نفس النتيجة. يُستدعى فقط
 * عند **النشر** (`BuilderPublishedExperienceVersionService::publish()`) —
 * حفظ المسودة (Authoring validation) يكتفي بالتحقق البنيوي
 * (`AppSchemaParser`)، مطابقاً لتمييز `APP_SCHEMA_V1.md` §21 بين تحقق
 * التأليف وتحقق النشر (الأخير أشدّ صراحةً). يفترض أن `$schema` مرّ فعلاً عبر
 * `AppSchemaParser::validate()` (بلا استثناء) — لا يعيد التحقق البنيوي.
 *
 * **قاعدة الإغلاق الآمن**: قدرة مطلوبة (component/action غير `optional`)
 * غير مدعومة تُفشل **الوثيقة كاملة**، لا الصفحة فقط — يطابق تعليق Dart
 * الحرفي: «reaching null here means a required descendant failed closed,
 * which must fail the whole document closed». عقدة اختيارية غير مدعومة
 * تُسقَط هي وشجرتها الفرعية كاملة (`fallbacks`)، والنشر يستمر.
 */
final class CompatibilityResolver
{
    public function resolve(array $schema, CapabilityManifest $manifest): CompatibilityResult
    {
        $schemaVersion = SchemaVersion::tryParse($schema['schemaVersion']);
        $minRuntimeVersion = SchemaVersion::tryParse($schema['minRuntimeVersion']);

        if ($schemaVersion->greaterThan($manifest->maxSupportedSchemaVersion)) {
            return CompatibilityResult::incompatible(
                CompatibilityResult::REASON_SCHEMA_VERSION_TOO_NEW,
                "schema {$schemaVersion} is newer than this runtime supports (max {$manifest->maxSupportedSchemaVersion})",
            );
        }
        if ($manifest->minSupportedSchemaVersion->greaterThan($schemaVersion)) {
            return CompatibilityResult::incompatible(
                CompatibilityResult::REASON_SCHEMA_VERSION_TOO_OLD,
                "schema {$schemaVersion} is older than this runtime supports (min {$manifest->minSupportedSchemaVersion})",
            );
        }
        if ($manifest->runtimeVersion->lessThan($minRuntimeVersion)) {
            return CompatibilityResult::incompatible(
                CompatibilityResult::REASON_RUNTIME_TOO_OLD,
                "runtime {$manifest->runtimeVersion} is older than schema requires (min {$minRuntimeVersion})",
            );
        }

        foreach (($schema['requiredCapabilities'] ?? []) as $key => $requiredVersion) {
            $have = $manifest->namedCapabilityVersion($key);
            if ($have === null || $have < $requiredVersion) {
                $haveLabel = $have === null ? 'none' : (string) $have;

                return CompatibilityResult::incompatible(
                    CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY,
                    "required capability \"{$key}\" v{$requiredVersion} is not available (have: {$haveLabel})",
                );
            }
        }

        $fallbacks = [];
        foreach (($schema['pages'] ?? []) as $pageId => $root) {
            $resolvedRoot = $this->resolveComponent($root, $manifest, $fallbacks);
            if ($resolvedRoot === false) {
                return CompatibilityResult::incompatible(
                    CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY,
                    "page \"{$pageId}\" contains a required, unsupported component or action",
                );
            }
        }

        return CompatibilityResult::compatible($fallbacks);
    }

    /**
     * يعيد `true` عند إمكان عرض العقدة (بغضّ النظر عن تقليم فرعي اختياري)،
     * أو `false` حين يكون نوع العقدة نفسها أو إجراؤها غير مدعوم. القرار
     * سقوط/تجاوز يُتّخذ عند الأب باستعمال علم `optional` **للطفل نفسه** —
     * وسم مكوّن اختيارياً يجعل شجرته الفرعية كلها وحدة إسقاط آمنة واحدة.
     *
     * @param  array<int, array{componentId: string, componentType: string, reason: string}>  &$fallbacks
     */
    private function resolveComponent(array $node, CapabilityManifest $manifest, array &$fallbacks): bool
    {
        $action = $node['action'] ?? null;
        $unsupportedHere = $manifest->componentVersion($node['type']) === null
            || ($action !== null && $manifest->actionVersion($action['type']) === null);
        if ($unsupportedHere) {
            return false;
        }

        foreach (($node['children'] ?? []) as $child) {
            $childOk = $this->resolveComponent($child, $manifest, $fallbacks);
            if (! $childOk) {
                if ($child['optional'] ?? false) {
                    $fallbacks[] = [
                        'componentId' => $child['id'],
                        'componentType' => $child['type'],
                        'reason' => 'unsupported component/action, or an unsupported required descendant within this optional subtree',
                    ];

                    continue;
                }

                return false;
            }
        }

        return true;
    }
}

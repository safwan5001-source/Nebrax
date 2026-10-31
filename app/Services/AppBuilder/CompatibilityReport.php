<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تقرير توافق استشاري لكل جيل Runtime — DRF-03 / CMP-10 (S03b)
 * ═══════════════════════════════════════════════════════════════
 *
 * يجيب عن سؤال المحرّر قبل النشر: «على كل جيل Runtime معروف، هل تُعرض هذه التجربة؟ وما الذي **سيُحذف** منها؟». المكوّن الاختياري
 * (`optional`) غير المدعوم يُحذف عمداً على الجيل القديم؛ التقرير يجعل ذلك **معلَناً لا صامتاً**: لكل جيل قائمة المكوّنات المحذوفة
 * (معرّف + نوع، بلا قيم مخطط)، و`min_runtime` = أقدم جيل يعرضها، و`full_runtime` = أقدم جيل يعرضها **كاملةً بلا حذف**.
 *
 * استشاري بحت: لا يمنع الحفظ ولا النشر (المنع قائم في `BuilderPublishedExperienceVersionService`). دالة قراءة بلا كتابة ولا أقفال.
 * مخطط لا يجتاز المحلل البنيوي ⇒ `null` (لا تقرير؛ المخالفات البنيوية تظهر عبر مساراتها).
 */
final class CompatibilityReport
{
    public function __construct(
        private readonly RuntimeGenerations $generations,
        private readonly AppSchemaParser $parser,
        private readonly CompatibilityResolver $resolver,
    ) {}

    /**
     * @param  array<string, mixed>  $schema  المخطط كما يُنشر (`publishableSchema()`)
     * @return array{generations: list<array<string, mixed>>, min_runtime: ?string, full_runtime: ?string, has_drops: bool}|null
     */
    public function forSchema(array $schema): ?array
    {
        try {
            $this->parser->validate($schema);
        } catch (SchemaFormatException) {
            return null;
        }

        $rows = [];
        $min = null;
        $full = null;
        $hasDrops = false;
        foreach ($this->generations->all() as $manifest) {
            $result = $this->resolver->resolve($schema, $manifest);
            $runtime = (string) $manifest->runtimeVersion;
            $dropped = array_map(
                fn (array $f) => ['component_id' => $f['componentId'], 'component_type' => $f['componentType']],
                $result->fallbacks,
            );
            $rows[] = ['runtime' => $runtime, 'compatible' => $result->compatible, 'reason' => $result->reason, 'dropped' => $dropped];

            if ($result->compatible) {
                $min ??= $runtime;
                $hasDrops = $hasDrops || $dropped !== [];
                if ($dropped === []) {
                    $full ??= $runtime;
                }
            }
        }

        return ['generations' => $rows, 'min_runtime' => $min, 'full_runtime' => $full, 'has_drops' => $hasDrops];
    }
}

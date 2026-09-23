<?php

namespace App\Services\AppBuilder;

/**
 * عدّاد عقد شجرة المكوّنات أثناء التحقق — مطابقٌ لـ `_ParseBudget` في
 * `mobile/lib/schema/app_schema.dart`. صنفٌ مستقل (لا داخل `AppSchemaParser`)
 * التزاماً بقاعدة PSR-4 «كلاس واحد لكل ملف» (`CLAUDE.md`).
 */
final class SchemaParseBudget
{
    private int $count = 0;

    public function __construct(private readonly int $maxNodes) {}

    public function consumeNode(): void
    {
        $this->count++;
        if ($this->count > $this->maxNodes) {
            throw new SchemaFormatException(
                'too_many_nodes',
                "component tree exceeds max node count ({$this->maxNodes})",
            );
        }
    }
}

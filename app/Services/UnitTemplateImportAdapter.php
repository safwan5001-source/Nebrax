<?php

namespace App\Services;

use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `unit_templates` (IMP-H4-S3): إنشاء قوالب الوحدات، **ذرّي بطبيعته** — وحدته الملف كله (القالب مجموعة صفوف لا تُجزَّأ، والقوالب قليلة). **غير مسجَّل بعد**
 * في `ImportDomainRegistry` ولا في `ImportJobDomain`، فلا يصل إليه أي طلب. بوابة الكتابة المباشرة المقابلة (`POST unit-templates`) هي `products.manage`.
 *
 * **بلا مسار ذكاء اصطناعي (قرار المالك D-08)**: لا يُسجَّل له نوع إجراء، والمحوّل لا يعرض واجهة تفويض للذكاء. لا يعدّل قالباً قائماً أبداً.
 */
class UnitTemplateImportAdapter extends SpreadsheetImportAdapter
{
    public const DOMAIN = ImportJobDomain::UNIT_TEMPLATES;

    public function domain(): string
    {
        return ImportJobDomain::UNIT_TEMPLATES;
    }

    public function unit(): string
    {
        return self::UNIT_FILE;
    }

    /** ذرّي: سقفه سقف خدمته نفسه غير مرفوع. */
    public function maxRows(): int
    {
        return UnitTemplateImportService::MAX_ROWS;
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'existing_policy' => (string) ($raw['existing_policy'] ?? UnitTemplateImportService::EXISTING_ERROR),
        ];

        return $this->withMapping($options, $raw);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $result = app(UnitTemplateImportService::class)->apply(
            $chunk->file,
            array_intersect_key($chunk->options, array_flip(['existing_policy', 'mapping'])),
            $chunk->userId,
        );

        return new ImportChunkResult((int) $chunk->job->row_count, $result);
    }
}

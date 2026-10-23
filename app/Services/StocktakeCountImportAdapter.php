<?php

namespace App\Services;

use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `stocktake_count` (IMP-H7-S1): كتابة أعداد ورقة جردٍ مفتوح، **ذرّي بطبيعته** — وحدته الورقة كلها (لا ورقة نصف معدودة). مسجَّل في
 * `ImportDomainRegistry` و`ImportJobDomain` منذ IMP-H7-S1b (مربوط بمعاينة وحده). بوابة الكتابة المباشرة المقابلة (`POST stocktakes/{id}/count`) هي `products.manage` + `inventory.core`.
 * يكتب العدّ فقط؛ ترحيل الفروق فعلٌ منفصل ولا يمرّ من هنا أبداً.
 */
class StocktakeCountImportAdapter extends SpreadsheetImportAdapter
{
    public const DOMAIN = ImportJobDomain::STOCKTAKE_COUNT;

    public function domain(): string
    {
        return self::DOMAIN;
    }

    public function unit(): string
    {
        return self::UNIT_FILE;
    }

    /** ذرّي: سقفه سقف خدمته نفسه غير مرفوع. */
    public function maxRows(): int
    {
        return StocktakeCountImportService::MAX_ROWS;
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'stocktake_id' => strtolower(trim((string) ($raw['stocktake_id'] ?? ''))),
            'existing_count_policy' => (string) ($raw['existing_count_policy'] ?? StocktakeCountImportService::POLICY_ERROR),
        ];

        return $this->withMapping($options, $raw);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $result = app(StocktakeCountImportService::class)->apply(
            $chunk->file,
            array_intersect_key($chunk->options, array_flip(['stocktake_id', 'existing_count_policy', 'mapping'])),
            $chunk->userId,
        );

        return new ImportChunkResult((int) $chunk->job->row_count, $result);
    }
}

<?php

namespace App\Services;

use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `stock_permit_import` (IMP-H7-S3): إنشاء **إذنٍ مخزني مسودة** من ملف، **ذرّي بطبيعته** — وحدته الملف كله (إذنٌ واحد بسطوره). مسجَّل في `ImportDomainRegistry`
 * و`ImportJobDomain` (مربوط بمعاينة وحده). بوابة الكتابة المباشرة المقابلة (`POST stock-permits`) هي `products.manage` + `inventory.core`. لا ترحيل ولا قيد ولا حركة
 * مخزون من هنا أبداً؛ **بلا مسار ذكاء اصطناعي (قرار المالك D-09)**.
 *
 * تاريخ الإذن الافتراضي (اليوم) يُحسم هنا عند المعاينة فيتجمّد مع بصمتها — لا يتغيّر إن نُفِّذت التشغيلة في يومٍ لاحق.
 */
class StockPermitImportAdapter extends SpreadsheetImportAdapter
{
    public const DOMAIN = ImportJobDomain::STOCK_PERMIT_IMPORT;

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
        return StockPermitImportService::MAX_ROWS;
    }

    public function canonicalOptions(array $raw): array
    {
        $target = $raw['target_warehouse_id'] ?? null;
        $options = [
            'permit_type' => (string) ($raw['permit_type'] ?? ''),
            'warehouse_id' => strtolower(trim((string) ($raw['warehouse_id'] ?? ''))),
            'target_warehouse_id' => $target === null || $target === '' ? null : strtolower(trim((string) $target)),
            'permit_date' => (string) (($raw['permit_date'] ?? '') !== '' ? $raw['permit_date'] : now()->toDateString()),
            'reason' => $this->nullableText($raw['reason'] ?? null),
            'notes' => $this->nullableText($raw['notes'] ?? null),
            'allow_zero_cost' => filter_var($raw['allow_zero_cost'] ?? false, FILTER_VALIDATE_BOOLEAN),
        ];

        return $this->withMapping($options, $raw);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $result = app(StockPermitImportService::class)->apply(
            $chunk->file,
            array_intersect_key($chunk->options, array_flip(['permit_type', 'warehouse_id', 'target_warehouse_id', 'permit_date', 'reason', 'notes', 'allow_zero_cost', 'mapping'])),
            $chunk->userId,
        );

        return new ImportChunkResult((int) $chunk->job->row_count, $result);
    }

    private function nullableText(mixed $value): ?string
    {
        $text = trim((string) ($value ?? ''));

        return $text === '' ? null : $text;
    }
}

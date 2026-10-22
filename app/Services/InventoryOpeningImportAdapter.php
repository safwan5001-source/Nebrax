<?php

namespace App\Services;

use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `inventory_opening` (كان `runInventoryOpeningChunk`، نقلٌ حرفي بلا تغيير سلوك — PR-DUR-4).
 *
 * ذرّيٌّ بطبيعته: `InventoryOpeningImportService::apply()` يحلّل الملف كاملاً ثم يستدعي
 * `InventoryOpeningService::createDraft()` مرّةً واحدة لكل أسطره داخل معاملةٍ واحدة (مستندٌ واحد لكل ملف). وحدته
 * **الملف كلّه**. **مسودة فقط — لا ترحيل:** `InventoryOpeningService::post()` فعلٌ بشريٌّ منفصل غير مربوط بهذا المحرّك.
 */
class InventoryOpeningImportAdapter extends SpreadsheetImportAdapter
{
    public function domain(): string
    {
        return ImportJobDomain::INVENTORY_OPENING;
    }

    public function unit(): string
    {
        return self::UNIT_FILE;
    }

    /** ذرّي: سقفه سقف خدمته نفسه غير مرفوع. */
    public function maxRows(): int
    {
        return InventoryOpeningImportService::MAX_ROWS;
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $openingOptions = array_intersect_key($chunk->options, array_flip(['opening_date', 'allow_zero_cost', 'notes', 'mapping']));

        $opening = app(InventoryOpeningImportService::class)->apply($chunk->file, $openingOptions, $chunk->userId);

        return new ImportChunkResult((int) $chunk->job->row_count, [
            'inventory_opening_id' => $opening->id,
            'number' => $opening->number,
            'status' => $opening->status,
            'total_quantity' => $opening->total_quantity,
            'total_value' => $opening->total_value,
            'lines_count' => $opening->lines->count(),
        ]);
    }
}

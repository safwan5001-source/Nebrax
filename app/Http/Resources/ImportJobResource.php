<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ImportJobResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'domain' => $this->domain,
            'branch_id' => $this->branch_id,
            'preview_bound' => $this->preview_id !== null,
            // IMP-H7-S1c: الجرد المستهدف المجمَّد لمجال أعداد الجرد وحده، كي لا تُستأنف تشغيلة جردٍ آخر من صفحة جردٍ مختلف فتُكتب الأعداد حيث لا يظن المستخدم.
            'target_id' => $this->when($this->domain === \App\Support\ImportJobDomain::STOCKTAKE_COUNT, fn () => ((array) $this->apply_options)['stocktake_id'] ?? null),
            'parent_job_id' => $this->parent_job_id,
            'status' => $this->status,
            'original_filename' => $this->original_filename,
            'extension' => $this->extension,
            'byte_size' => (int) $this->byte_size,
            'content_sha256' => $this->content_sha256,
            'media_archive' => $this->media_archive_original_filename === null ? null : [
                'original_filename' => $this->media_archive_original_filename,
                'byte_size' => (int) $this->media_archive_byte_size,
                'content_sha256' => $this->media_archive_content_sha256,
            ],
            'row_count' => $this->row_count === null ? null : (int) $this->row_count,
            'column_count' => $this->column_count === null ? null : (int) $this->column_count,
            'processed_rows' => (int) $this->processed_rows,
            'apply_result' => $this->apply_result,
            'error_message' => $this->error_message,
            // IMP-H1-S8a: يظهر في عرض التشغيلة المفردة فقط (withCount) — صفرٌ حين لا وحدات فاشلة.
            'failed_units' => $this->when(isset($this->failed_units_count), fn () => (int) $this->failed_units_count),
            'created_by' => $this->created_by,
            'cancelled_by' => $this->cancelled_by,
            'cancelled_at' => optional($this->cancelled_at)->toIso8601String(),
            'purge_after' => optional($this->purge_after)->toIso8601String(),
            'created_at' => optional($this->created_at)->toIso8601String(),
            'updated_at' => optional($this->updated_at)->toIso8601String(),
        ];
    }
}

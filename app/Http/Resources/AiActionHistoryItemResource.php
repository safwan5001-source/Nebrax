<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * IMP-H8-S4a: صفّ سجلّ AI Actions — ملخّص فقط. لا مقترح ولا تكلفة ولا معاينة؛ للتفاصيل `GET ai-actions/{id}` (بتفويضه الكامل).
 * يتلقّى آخر نسخة (بلا عمود المقترح) وآخر تنفيذ جاهزين من الخدمة كي لا يكون هناك N+1.
 */
class AiActionHistoryItemResource extends JsonResource
{
    public function __construct($resource, private readonly mixed $latest, private readonly ?array $execution)
    {
        parent::__construct($resource);
    }

    public function toArray(Request $request): array
    {
        $summary = $this->latest?->validation_summary ?? [];

        return [
            'id' => $this->id,
            'type' => $this->type,
            'schema_version' => (int) $this->schema_version,
            'status' => $this->status,
            'version' => (int) $this->resource->version,
            'branch_id' => $this->branch_id,
            'created_by' => $this->created_by,
            'created_by_name' => $this->creator?->name,
            'summary' => [
                'row_count' => isset($summary['row_count']) ? (int) $summary['row_count'] : null,
                'error_count' => isset($summary['error_count']) ? (int) $summary['error_count'] : null,
                'needs_review_count' => isset($summary['needs_review_count']) ? (int) $summary['needs_review_count'] : null,
            ],
            'execution' => $this->execution,
            'cancelled_at' => optional($this->cancelled_at)->toIso8601String(),
            'expires_at' => optional($this->expires_at)->toIso8601String(),
            'created_at' => optional($this->created_at)->toIso8601String(),
            'updated_at' => optional($this->updated_at)->toIso8601String(),
        ];
    }
}

<?php

namespace App\Models;

use App\Tenancy\BranchContext;
use App\Tenancy\BranchScoped;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** مرشح بديل مرتب حتمياً لمطابقة دليل مستخرج. */
class DocumentMatchCandidate extends BaseModel
{
    use BranchScoped;

    protected $fillable = [
        'document_match_result_id', 'candidate_type', 'candidate_id', 'rank',
        'score_basis_points', 'strategy', 'explanation_codes', 'snapshot',
    ];

    protected function casts(): array
    {
        return [
            'rank' => 'integer',
            'score_basis_points' => 'integer',
            'explanation_codes' => 'array',
            'snapshot' => 'array',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $candidate): void {
            $tenant = app(TenantContext::class);
            $branch = app(BranchContext::class);
            if (! $tenant->has() || ! $branch->has()) {
                throw new LogicException('Document match candidates require trusted tenant and branch contexts.');
            }

            $result = DocumentMatchResult::query()->findOrFail($candidate->document_match_result_id);
            if ($result->tenant_id !== $tenant->id() || $result->branch_id !== $branch->id()) {
                throw new LogicException('Document match candidate scope must match its result.');
            }
            if ($candidate->rank < 1 || $candidate->score_basis_points < 0 || $candidate->score_basis_points > 10000) {
                throw new LogicException('Document match candidate rank and score are invalid.');
            }

            $candidate->tenant_id = $tenant->id();
            $candidate->branch_id = $branch->id();
        });

        static::updating(fn () => throw new LogicException('Document match candidates are immutable review evidence.'));
        static::deleting(fn () => throw new LogicException('Document match candidates are retained as review evidence.'));
    }

    public function result(): BelongsTo
    {
        return $this->belongsTo(DocumentMatchResult::class, 'document_match_result_id');
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Models\Branch;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\ManualJournal;
use App\Support\Money;
use App\Tenancy\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * سجل قراءة موحّد للقيود المرحّلة الناتجة من المستندات والقيود اليدوية.
 * لا يقدّم أي تعديل عام: القيود الآلية تصحح من المصدر، واليدوية من وحدتها.
 */
class JournalEntryController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $branchIds = $this->requestedBranchIds($request, useActiveBranch: true);
        $query = $this->applyBranchSelection(JournalEntry::query(), $branchIds);

        return response()->json([
            'data' => $this->withVisibleLines($query, $branchIds)
                ->orderByDesc('entry_date')
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (JournalEntry $entry) => $this->mapEntry($entry))
                ->values(),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        // شاشة التفاصيل تُقيَّد بصلاحيات المستخدم، لا بالفرع النشط؛ وبذلك يظل
        // فتح قيد من نتيجة «كل الفروع» أو من فرع آخر مسموح به ممكناً وآمناً.
        $branchIds = $this->requestedBranchIds($request, useActiveBranch: false);
        $query = $this->applyBranchSelection(JournalEntry::query(), $branchIds);
        $entry = $this->withVisibleLines($query, $branchIds)->whereKey($id)->firstOrFail();

        return response()->json(['data' => $this->mapEntry($entry)]);
    }

    /**
     * يعيد null للمستخدم غير المقيّد عندما يريد كل الفروع، ومصفوفة معرفات في
     * كل الحالات المقيّدة. معامل `branch` فلتر عرض مستقل تماماً عن BranchContext.
     */
    private function requestedBranchIds(Request $request, bool $useActiveBranch): ?array
    {
        $allowed = $request->user()?->allowedBranchIds();
        $requested = $request->query('branch');

        if ($requested === 'all') {
            return $allowed;
        }

        if (is_string($requested) && $requested !== '') {
            $valid = Str::isUuid($requested)
                && Branch::whereKey($requested)->exists()
                && ($allowed === null || in_array($requested, $allowed, true));

            if (! $valid) {
                abort(422, 'الفرع المحدد غير متاح ضمن نطاق صلاحياتك.');
            }

            return [$requested];
        }

        if (! $useActiveBranch) {
            return $allowed;
        }

        $branchId = app(BranchContext::class)->id();
        return $branchId !== null ? [$branchId] : $allowed;
    }

    private function applyBranchSelection(Builder $query, ?array $branchIds): Builder
    {
        if ($branchIds === null) {
            return $query;
        }

        return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, $branchIds));
    }

    /**
     * لا يكفي تقييد whereHas وحده: قد يحمل القيد نفسه سطوراً من فروع متعددة.
     * لذلك تُقيَّد السطور المُعادة أيضاً كي لا تتسرّب سطور فرع غير مصرّح به.
     */
    private function withVisibleLines(Builder $query, ?array $branchIds): Builder
    {
        if ($branchIds === null) {
            return $query->with(['lines.account']);
        }

        return $query->with([
            'lines' => fn (Builder $lines) => $this->filterLinesForBranches($lines, $branchIds)->with('account'),
        ]);
    }

    private function filterLinesForBranches(Builder $lines, array $branchIds): Builder
    {
        return $lines->where(function (Builder $query) use ($branchIds) {
            $query->whereIn('branch_id', $branchIds)->orWhereNull('branch_id');
        });
    }

    private function mapEntry(JournalEntry $entry): array
    {
        $lines = $entry->lines;
        $sourceType = $entry->source_type;

        return [
            'id' => $entry->id,
            'number' => $entry->number,
            'entry_date' => $entry->entry_date->toDateString(),
            'description' => $entry->description,
            'status' => $entry->status,
            'entry_kind' => $entry->reversal_of
                ? 'reversal'
                : ($sourceType === ManualJournal::class ? 'manual' : 'automatic'),
            'source_type' => $sourceType,
            'source_id' => $entry->source_id,
            'reversal_of' => $entry->reversal_of,
            'total' => Money::toRiyal($lines->sum('debit')),
            'lines' => $lines->map(fn (JournalLine $line) => [
                'id' => $line->id,
                'account_id' => $line->account_id,
                'account_code' => $line->account?->code,
                'account_name' => $line->account?->name,
                'description' => $line->description,
                'debit' => Money::toRiyal($line->debit),
                'credit' => Money::toRiyal($line->credit),
                'cost_center_id' => $line->cost_center_id,
                'partner_id' => $line->partner_id,
            ])->values(),
        ];
    }
}

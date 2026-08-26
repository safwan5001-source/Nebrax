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
        return response()->json([
            'data' => $this->visibleEntries($request)
                ->with(['lines.account'])
                ->orderByDesc('entry_date')
                ->orderByDesc('created_at')
                ->get()
                ->map(fn (JournalEntry $entry) => $this->mapEntry($entry))
                ->values(),
        ]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $entry = $this->visibleEntries($request)
            ->with(['lines.account'])
            ->whereKey($id)
            ->firstOrFail();

        return response()->json(['data' => $this->mapEntry($entry)]);
    }

    /**
     * JournalEntry لا يحمل branch_id؛ يُحكم نطاقه من سطوره. يشمل هذا الفلتر
     * السطور المركزية ذات branch_id = null، متسقاً مع بقية قوائم المستندات.
     *
     * معامل `branch` هنا فلتر عرض مستقل عن BranchContext:
     * `all` يجمع الفروع المسموح بها فقط، وUUID صالح يضيّق العرض إلى فرع واحد
     * بعد التحقق من TenantScope وصلاحية المستخدم. غياب المعامل يبقي السلوك
     * التشغيلي القديم ويستخدم الفرع النشط القادم من X-Branch-Id.
     */
    private function visibleEntries(Request $request): Builder
    {
        $query = JournalEntry::query();
        $allowed = $request->user()?->allowedBranchIds();
        $requested = $request->query('branch');

        if ($requested === 'all') {
            if ($allowed === null) {
                return $query;
            }

            return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, $allowed));
        }

        if (is_string($requested) && $requested !== '') {
            $valid = Str::isUuid($requested)
                && Branch::whereKey($requested)->exists()
                && ($allowed === null || in_array($requested, $allowed, true));

            if (! $valid) {
                abort(422, 'الفرع المحدد غير متاح ضمن نطاق صلاحياتك.');
            }

            return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, [$requested]));
        }

        $branchId = app(BranchContext::class)->id();
        if ($branchId === null) {
            if ($allowed === null) {
                return $query;
            }

            return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, $allowed));
        }

        return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, [$branchId]));
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

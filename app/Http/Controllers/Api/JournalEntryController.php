<?php

namespace App\Http\Controllers\Api;

use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\ManualJournal;
use App\Support\Money;
use App\Tenancy\BranchContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * سجل قراءة موحّد للقيود المرحّلة الناتجة من المستندات والقيود اليدوية.
 * لا يقدّم أي تعديل عام: القيود الآلية تصحح من المصدر، واليدوية من وحدتها.
 */
class JournalEntryController extends ApiController
{
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'entry_kind' => ['sometimes', 'nullable', 'in:manual,automatic,reversal'],
            'source_type' => ['sometimes', 'nullable', 'string', 'max:255'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:date_from'],
            // لا تقبل `numeric` هنا: تقبل الصيغة الأسّية ثم يفسّرها محول
            // الهللات كنص كسري مختلف. هذا الحقل مبلغ معروض ذو منزلتين فقط.
            'amount_min' => ['sometimes', 'nullable', 'regex:/^\d+(?:\.\d{1,2})?$/'],
            'amount_max' => ['sometimes', 'nullable', 'regex:/^\d+(?:\.\d{1,2})?$/'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
        ]);

        // لا تُشتق خيارات المصدر من صفحة النتائج: pagination لا يصف كل المصادر
        // الممكنة. تُحسب من النطاق المرئي ومن باقي الفلاتر، مع إزالة فلتر المصدر
        // ذاته كي لا تختفي الخيارات عند تغيير اختيار المستخدم.
        $facetFilters = $filters;
        unset($facetFilters['source_type']);
        $sourceTypes = $this->applyListFilters($this->visibleEntries($request), $facetFilters)
            ->whereNotNull('source_type')
            ->distinct()
            ->orderBy('source_type')
            ->pluck('source_type')
            ->values();

        $query = $this->applyListFilters($this->visibleEntries($request), $filters)
            ->with(['lines.account']);
        $this->applyListSort($query, $filters['sort'] ?? null);

        if (isset($filters['per_page'])) {
            $paginator = $query->paginate((int) $filters['per_page'])->withQueryString();

            return response()->json([
                'data' => collect($paginator->items())->map(fn (JournalEntry $entry) => $this->mapEntry($entry))->values(),
                'meta' => [
                    'current_page' => $paginator->currentPage(),
                    'last_page' => $paginator->lastPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                ],
                'facets' => [
                    'source_types' => $sourceTypes,
                ],
            ]);
        }

        // توافق رجعي: المستهلكون القدامى بلا `per_page` يستمرون بقائمة كاملة.
        return response()->json([
            'data' => $query->get()->map(fn (JournalEntry $entry) => $this->mapEntry($entry))->values(),
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
     */
    private function visibleEntries(Request $request): Builder
    {
        $query = JournalEntry::query();
        $allowed = $request->user()?->allowedBranchIds();

        if ($request->query('branch') === 'all') {
            if ($allowed === null) {
                return $query;
            }

            return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, $allowed));
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

    /**
     * كل شرط هنا يضيف تضييقاً فوق `visibleEntries()`؛ لا يعيد بناء استعلام يتجاوز
     * نطاق المستأجر أو نطاق الفروع المستمد من سطور القيد.
     */
    private function applyListFilters(Builder $query, array $filters): Builder
    {
        if ($search = trim((string) ($filters['search'] ?? ''))) {
            $escaped = addcslashes($search, '%_\\');
            $query->where(function (Builder $builder) use ($escaped) {
                $builder
                    ->where('number', 'like', "%{$escaped}%")
                    ->orWhere('description', 'like', "%{$escaped}%")
                    ->orWhere('source_type', 'like', "%{$escaped}%");
            });
        }

        if (! empty($filters['entry_kind'])) {
            match ($filters['entry_kind']) {
                'manual' => $query->where('source_type', ManualJournal::class),
                'reversal' => $query->whereNotNull('reversal_of'),
                // NULL != ManualJournal ينتج UNKNOWN في SQL. القيد غير العاكس
                // بلا مصدر ما زال آلياً وفق mapEntry() وعقد LedgerService.
                'automatic' => $query->whereNull('reversal_of')->where(function (Builder $automatic) {
                    $automatic->whereNull('source_type')->orWhere('source_type', '!=', ManualJournal::class);
                }),
            };
        }

        if ($sourceType = trim((string) ($filters['source_type'] ?? ''))) {
            if (str_contains($sourceType, '\\')) {
                $query->where('source_type', $sourceType);
            } else {
                // دعم روابط الواجهة القديمة التي حفظت الاسم المختصر للمصدر.
                $query->where('source_type', 'like', '%'.addcslashes($sourceType, '%_\\'));
            }
        }

        if (! empty($filters['date_from'])) $query->whereDate('entry_date', '>=', $filters['date_from']);
        if (! empty($filters['date_to'])) $query->whereDate('entry_date', '<=', $filters['date_to']);
        if (isset($filters['amount_min'])) $query->whereRaw($this->entryTotalSql().' >= ?', [$this->moneyFilterToMinor((string) $filters['amount_min'])]);
        if (isset($filters['amount_max'])) $query->whereRaw($this->entryTotalSql().' <= ?', [$this->moneyFilterToMinor((string) $filters['amount_max'])]);

        return $query;
    }

    private function applyListSort(Builder $query, ?string $sort): void
    {
        $sort = $sort ?: '-entry_date';
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $field = ltrim($sort, '-');

        if ($field === 'total') {
            $query->orderByRaw($this->entryTotalSql()." {$direction}");
        } elseif ($field === 'entry_kind') {
            $query->orderByRaw(
                "CASE WHEN reversal_of IS NOT NULL THEN 2 WHEN source_type = ? THEN 1 ELSE 0 END {$direction}",
                [ManualJournal::class],
            );
        } elseif (in_array($field, ['number', 'entry_date', 'created_at'], true)) {
            $query->orderBy($field, $direction);
        } else {
            $query->orderByDesc('entry_date');
        }

        $query->orderByDesc('id');
    }

    /** قيمة القيد المعروضة هي مجموع المدين بالهللات؛ الاستعلام لا يعتمد على float. */
    private function entryTotalSql(): string
    {
        return '(SELECT COALESCE(SUM(journal_lines.debit), 0) FROM journal_lines WHERE journal_lines.journal_entry_id = journal_entries.id)';
    }

    private function moneyFilterToMinor(string $value): int
    {
        // التحقق في index() يقبل صيغة عشرية موجبة ثابتة ذات منزلتين كحد أقصى.
        // لذلك لا تدخل قيم علمية أو محارف لا يمكن تحويلها بصدق إلى هللات.
        [$whole, $fraction] = array_pad(explode('.', trim($value), 2), 2, '');

        return ((int) $whole * 100) + (int) str_pad($fraction, 2, '0');
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

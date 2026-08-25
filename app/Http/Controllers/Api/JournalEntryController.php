<?php

namespace App\Http\Controllers\Api;

use App\Models\Asset;
use App\Models\CreditNote;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\ManualJournal;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\ReturnDocument;
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
            'source_type' => ['sometimes', 'nullable', 'string', 'max:80'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date'],
            'amount_min' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'amount_max' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ]);

        $query = $this->visibleEntries($request)->with(['lines.account']);

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function (Builder $search) use ($like): void {
                $search->where('number', 'like', $like)
                    ->orWhere('description', 'like', $like)
                    ->orWhere('status', 'like', $like)
                    ->orWhere('source_type', 'like', $like);
            });
        }

        if (filled($filters['entry_kind'] ?? null)) {
            match ($filters['entry_kind']) {
                'reversal' => $query->whereNotNull('reversal_of'),
                'manual' => $query->whereNull('reversal_of')->where('source_type', ManualJournal::class),
                'automatic' => $query->whereNull('reversal_of')->where(function (Builder $kind): void {
                    $kind->whereNull('source_type')->orWhere('source_type', '!=', ManualJournal::class);
                }),
                default => null,
            };
        }

        if (filled($filters['source_type'] ?? null)) {
            $sourceMap = [
                'Invoice' => Invoice::class,
                'Purchase' => Purchase::class,
                'Payment' => Payment::class,
                'Expense' => Expense::class,
                'CreditNote' => CreditNote::class,
                'ReturnDocument' => ReturnDocument::class,
                'Asset' => Asset::class,
                'ManualJournal' => ManualJournal::class,
            ];
            $source = $sourceMap[$filters['source_type']] ?? null;
            if ($source === null) {
                $query->whereRaw('1 = 0');
            } else {
                $query->where('source_type', $source);
            }
        }

        if (filled($filters['date_from'] ?? null)) $query->whereDate('entry_date', '>=', $filters['date_from']);
        if (filled($filters['date_to'] ?? null)) $query->whereDate('entry_date', '<=', $filters['date_to']);

        $totalSql = '(SELECT COALESCE(SUM(journal_lines.debit), 0) FROM journal_lines WHERE journal_lines.journal_entry_id = journal_entries.id)';
        if (filled($filters['amount_min'] ?? null)) {
            $query->whereRaw("{$totalSql} >= ?", [$this->moneyFilterToMinor((string) $filters['amount_min'])]);
        }
        if (filled($filters['amount_max'] ?? null)) {
            $query->whereRaw("{$totalSql} <= ?", [$this->moneyFilterToMinor((string) $filters['amount_max'])]);
        }

        $paginated = isset($filters['per_page']);
        $sort = (string) ($filters['sort'] ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $sortKey = ltrim($sort, '-');

        if ($sortKey === 'total' && $sort !== '') {
            $query->orderByRaw("{$totalSql} {$direction}")->orderByDesc('id');
        } elseif ($sortKey === 'entry_kind' && $sort !== '') {
            $manual = str_replace("'", "''", ManualJournal::class);
            $query->orderByRaw("CASE WHEN reversal_of IS NOT NULL THEN 2 WHEN source_type = '{$manual}' THEN 0 ELSE 1 END {$direction}")
                ->orderByDesc('id');
        } elseif (in_array($sortKey, ['entry_date', 'number', 'created_at'], true) && $sort !== '') {
            $query->orderBy($sortKey, $direction)->orderByDesc('id');
        } else {
            $query->orderByDesc('entry_date')->orderByDesc('created_at')->orderByDesc('id');
        }

        if ($paginated) {
            $paginator = $query->paginate((int) $filters['per_page'])->withQueryString();
            return response()->json([
                'data' => collect($paginator->items())->map(fn (JournalEntry $entry) => $this->mapEntry($entry))->values(),
                'links' => [
                    'first' => $paginator->url(1),
                    'last' => $paginator->url($paginator->lastPage()),
                    'prev' => $paginator->previousPageUrl(),
                    'next' => $paginator->nextPageUrl(),
                ],
                'meta' => [
                    'current_page' => $paginator->currentPage(),
                    'last_page' => $paginator->lastPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                ],
            ]);
        }

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

    private function visibleEntries(Request $request): Builder
    {
        $query = JournalEntry::query();
        $allowed = $request->user()?->allowedBranchIds();

        if ($request->query('branch') === 'all') {
            if ($allowed === null) return $query;
            return $query->whereHas('lines', fn (Builder $lines) => $this->filterLinesForBranches($lines, $allowed));
        }

        $branchId = app(BranchContext::class)->id();
        if ($branchId === null) {
            if ($allowed === null) return $query;
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

    private function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);
        return ((int) $whole * 100) + (int) $fraction;
    }
}

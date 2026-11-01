<?php

namespace App\Http\Controllers\Api;

use App\Services\PartnerStatementMatchService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * مطابقة كشوف الأطراف (IMP-PS-A2c): تشغيل · قراءة النتائج · التحقق من مجموعة many-to-one. **لا أثر مالي**؛ لا خيارات مطابقة في الطلب (السياسة مجمَّدة في المقارنة).
 * الصلاحيات: التشغيل `partner_statements.reconcile`، والقراءة `partner_statements.view` (على المسار) + رؤية الطرف والفرع داخل الخدمة.
 */
class PartnerStatementMatchController extends ApiController
{
    public function __construct(protected PartnerStatementMatchService $matching) {}

    public function run(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, []);
        $result = $this->domain(fn () => $this->matching->run($request->user(), $id));

        return response()->json(['data' => $result], $result['created'] ? 201 : 200);
    }

    public function matches(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['run_id', 'side', 'outcome', 'per_page', 'page']);
        $filters = $request->validate([
            'run_id' => ['nullable', 'uuid'],
            'side' => ['nullable', Rule::in(['statement', 'ledger'])],
            'outcome' => ['nullable', 'array', 'max:10'],
            'outcome.*' => ['string', Rule::in(['matched', 'amount_difference', 'date_difference', 'ambiguous', 'missing_in_books', 'missing_in_statement', 'needs_review', 'neutralised', 'incomplete'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.PartnerStatementMatchService::MAX_PER_PAGE],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ]);
        $result = $this->domain(fn () => $this->matching->matches($request->user(), $id, $filters));
        $page = $result['page'];

        return response()->json([
            'data' => $page === null ? [] : $page->getCollection()->map(fn ($m): array => $this->present($m))->values()->all(),
            'run' => $result['run'],
            'ledger_changed' => $result['ledger_changed'],
            'meta' => $page === null ? ['current_page' => 1, 'last_page' => 1, 'per_page' => 0, 'total' => 0] : [
                'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total(),
            ],
        ]);
    }

    public function verifySet(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['line_id', 'unit_keys']);
        $data = $request->validate([
            'line_id' => ['required', 'uuid'],
            'unit_keys' => ['required', 'array', 'min:1', 'max:'.PartnerStatementMatchService::MAX_SET],
            'unit_keys.*' => ['required', 'string', 'max:100'],
        ]);

        return response()->json(['data' => $this->domain(fn () => $this->matching->verifySet($request->user(), $id, $data['line_id'], $data['unit_keys']))]);
    }

    /** @return array<string, mixed> */
    private function present(\App\Models\PartnerStatementMatch $m): array
    {
        return [
            'id' => $m->id, 'side' => $m->side, 'line_id' => $m->line_id, 'ordinal' => $m->ordinal, 'outcome' => $m->outcome, 'rule' => $m->rule, 'unit_key' => $m->unit_key,
            'difference_minor' => $m->difference_minor, 'day_difference' => $m->day_difference, 'explanation' => $m->explanation, 'warnings' => $m->warnings ?? [],
            'unit' => $m->unit, 'candidates' => $m->candidates, 'suggestions' => $m->suggestions,
        ];
    }

    /** @param list<string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $extra = array_diff(array_merge(array_keys($request->query()), array_keys($request->post())), $allowed);
        if ($extra !== []) {
            abort(422, 'معاملات غير مدعومة: '.implode('، ', $extra));
        }
    }
}

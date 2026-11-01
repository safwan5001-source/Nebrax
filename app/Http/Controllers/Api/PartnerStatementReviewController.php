<?php

namespace App\Http\Controllers\Api;

use App\Models\PartnerStatementReviewDecision;
use App\Services\PartnerStatementMatchService;
use App\Services\PartnerStatementReviewService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * مراجعة نتائج مطابقة كشوف الأطراف (IMP-PS-A3a): تأكيد · تجاوز · سحب، وقراءة القرارات. **لا أثر مالي**. الكتابة `partner_statements.reconcile`، والقراءة `.view`
 * (على المسار) + نطاق الطرف والفرع والتشغيلة داخل الخدمة. أخطاء المراجعة (`PartnerStatementReviewException`) تُرسل `{message, reason}` بحالتها الصريحة.
 */
class PartnerStatementReviewController extends ApiController
{
    public function __construct(protected PartnerStatementReviewService $review) {}

    public function decide(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['run_id', 'line_id', 'action', 'unit_keys', 'reason', 'accept_difference']);
        $data = $request->validate([
            'run_id' => ['required', 'uuid'],
            'line_id' => ['required', 'uuid'],
            'action' => ['required', Rule::in(PartnerStatementReviewDecision::ACTIONS)],
            'unit_keys' => ['nullable', 'array', 'max:'.PartnerStatementMatchService::MAX_SET],
            'unit_keys.*' => ['required', 'string', 'max:100'],
            'reason' => ['nullable', 'string', 'max:500'],
            'accept_difference' => ['nullable', 'boolean'],
        ]);
        $result = $this->domain(fn () => $this->review->decide($request->user(), $id, $data));

        return response()->json(['data' => $result['decision'], 'replayed' => $result['replayed'], 'warnings' => $result['warnings']], $result['replayed'] ? 200 : 201);
    }

    public function index(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['line_id', 'history', 'per_page', 'page']);
        $filters = $request->validate([
            'line_id' => ['nullable', 'uuid'],
            'history' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.PartnerStatementReviewService::MAX_PER_PAGE],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ]);
        $page = $this->domain(fn () => $this->review->list($request->user(), $id, $filters));

        return response()->json([
            'data' => $page->items(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()],
        ]);
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

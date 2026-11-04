<?php

namespace App\Http\Controllers\Api;

use App\Models\PartnerStatementReconciliation;
use App\Services\PartnerStatementReconciliationQuery;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * قراءة مقارنات كشوف الأطراف (IMP-PS-A4a0، N1/N2/N4): القائمة · الرأس · سطور الكشف. **قراءة فقط، لا أثر مالي**. الصلاحية `partner_statements.view` وبوابة القدرة على المسار،
 * ورؤية الطرف/الفرع داخل `PartnerStatementReconciliationQuery` (استعلام مجمَّع للقائمة؛ الرفض الموحَّد `PARTNER_UNAVAILABLE` للرأس والسطور). المعاملات المجهولة ⇒ 422.
 */
class PartnerStatementReconciliationController extends ApiController
{
    public function __construct(protected PartnerStatementReconciliationQuery $reads) {}

    public function index(Request $request): JsonResponse
    {
        $this->rejectUnknown($request, ['status', 'partner_id', 'role', 'period_from', 'period_to', 'branch_id', 'q', 'sort', 'per_page', 'page']);
        $filters = $request->validate([
            'status' => ['nullable', 'array', 'max:5'],
            'status.*' => ['string', Rule::in([
                PartnerStatementReconciliation::STATUS_DRAFT, PartnerStatementReconciliation::STATUS_REVIEWED, PartnerStatementReconciliation::STATUS_CLOSED,
                PartnerStatementReconciliation::STATUS_VOIDED, PartnerStatementReconciliation::STATUS_SUPERSEDED,
            ])],
            'partner_id' => ['nullable', 'uuid'],
            'role' => ['nullable', Rule::in(PartnerStatementReconciliation::ROLES)],
            'period_from' => ['nullable', 'date_format:Y-m-d'],
            'period_to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:period_from'],
            'branch_id' => ['nullable', 'uuid'],
            'q' => ['nullable', 'string', 'max:100'],
            'sort' => ['nullable', 'string', Rule::in(array_merge(
                PartnerStatementReconciliationQuery::SORTS,
                array_map(fn (string $key): string => '-'.$key, PartnerStatementReconciliationQuery::SORTS),
            ))],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.PartnerStatementReconciliationQuery::MAX_PER_PAGE],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ]);
        $page = $this->domain(fn () => $this->reads->paginate($request->user(), $filters));

        return response()->json(['data' => $page->items(), 'meta' => $this->meta($page)]);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, []);

        return response()->json(['data' => $this->domain(fn () => $this->reads->header($request->user(), $id))]);
    }

    public function lines(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['per_page', 'page']);
        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.PartnerStatementReconciliationQuery::MAX_PER_PAGE],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ]);
        $page = $this->domain(fn () => $this->reads->lines($request->user(), $id, $filters));

        return response()->json(['data' => $page->items(), 'meta' => $this->meta($page)]);
    }

    /** @return array<string, int> */
    private function meta(\Illuminate\Contracts\Pagination\LengthAwarePaginator $page): array
    {
        return ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'per_page' => $page->perPage(), 'total' => $page->total()];
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

<?php

namespace App\Http\Controllers\Api;

use App\Services\PartnerStatementLifecycleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * دورة حالات مقارنة كشف الطرف (IMP-PS-A3c): حالة وجاهزية · `review` (draft → reviewed) · `reopen` (reviewed → draft) · `close` (PS-A3d: إغلاق نهائي بمطالبات وفصل مهام، `partner_statements.close`) · سجل الأحداث. **لا أثر مالي.**
 * الكتابة `partner_statements.reconcile` (والإغلاق `partner_statements.close`)، والقراءة `.view` (على المسار) + نطاق الطرف والفرع والتشغيلة داخل الخدمة. أخطاء الدورة (`PartnerStatementReviewException`) تُرسل `{message, reason}`.
 */
class PartnerStatementLifecycleController extends ApiController
{
    public function __construct(protected PartnerStatementLifecycleService $lifecycle) {}

    public function status(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['run_id']);
        $data = $request->validate(['run_id' => ['nullable', 'uuid']]);

        return response()->json(['data' => $this->domain(fn () => $this->lifecycle->status($request->user(), $id, $data['run_id'] ?? null))]);
    }

    public function review(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['run_id', 'note']);
        $data = $request->validate(['run_id' => ['required', 'uuid'], 'note' => ['nullable', 'string', 'max:500']]);
        $result = $this->domain(fn () => $this->lifecycle->markReviewed($request->user(), $id, $data['run_id'], $data['note'] ?? null));

        return response()->json(['data' => $result['status'], 'replayed' => $result['replayed']], $result['replayed'] ? 200 : 201);
    }

    public function reopen(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['reason']);
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);

        return response()->json(['data' => $this->domain(fn () => $this->lifecycle->reopen($request->user(), $id, $data['reason']))]);
    }

    public function close(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['run_id', 'acknowledge_overlap', 'note']);
        // قائمة الإقرار بلا سقف عدد: يجب أن تطابق قائمة الخادم كاملةً (D-PS-14)؛ يحدّها حجم الطلب وحده.
        $data = $request->validate([
            'run_id' => ['required', 'uuid'], 'acknowledge_overlap' => ['nullable', 'array'], 'acknowledge_overlap.*' => ['uuid'], 'note' => ['nullable', 'string', 'max:500'],
        ]);
        $result = $this->domain(fn () => $this->lifecycle->close($request->user(), $id, $data));

        return response()->json(['data' => $result['status'], 'replayed' => $result['replayed']], $result['replayed'] ? 200 : 201);
    }

    /** إبطال مطابقة مغلقة (PS-A3e): `closed → voided` بسبب إلزامي، وتُفرَج مطالباتها النشطة في المعاملة نفسها. `partner_statements.void`. */
    public function void(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['reason']);
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);
        $result = $this->domain(fn () => $this->lifecycle->void($request->user(), $id, $data['reason']));

        return response()->json(['data' => $result['status'], 'replayed' => $result['replayed']], $result['replayed'] ? 200 : 201);
    }

    /**
     * استبدال ذرّي (PS-A3e): يُبطَل كل نهائي في `replaces` (`closed → superseded`) ثم تُغلق مطابقة `{id}` المراجَعة في معاملة واحدة.
     * يتطلب الإغلاق (`partner_statements.close` على المسار) **و**الإبطال (`partner_statements.void` تتحقق منه الخدمة).
     */
    public function replace(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['run_id', 'replaces', 'reason', 'acknowledge_overlap', 'note']);
        $data = $request->validate([
            'run_id' => ['required', 'uuid'], 'replaces' => ['required', 'array', 'min:1', 'max:'.PartnerStatementLifecycleService::MAX_REPLACES], 'replaces.*' => ['uuid', 'distinct'],
            'reason' => ['required', 'string', 'max:500'], 'acknowledge_overlap' => ['nullable', 'array'], 'acknowledge_overlap.*' => ['uuid'], 'note' => ['nullable', 'string', 'max:500'],
        ]);
        $result = $this->domain(fn () => $this->lifecycle->replace($request->user(), $id, $data));

        return response()->json(['data' => $result['status'], 'replayed' => $result['replayed']], $result['replayed'] ? 200 : 201);
    }

    public function events(Request $request, string $id): JsonResponse
    {
        $this->rejectUnknown($request, ['per_page', 'page']);
        $filters = $request->validate([
            'per_page' => ['nullable', 'integer', 'min:1', 'max:'.PartnerStatementLifecycleService::MAX_PER_PAGE],
            'page' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ]);
        $page = $this->domain(fn () => $this->lifecycle->events($request->user(), $id, $filters));

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

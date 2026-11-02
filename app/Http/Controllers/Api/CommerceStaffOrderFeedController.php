<?php

namespace App\Http\Controllers\Api;

use App\Services\Commerce\CommerceOrderAttentionQuery;
use App\Services\Commerce\CommerceOrderFeedReader;
use App\Support\CommerceOrderFeedSerializer;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * COPS-H1-2 — تغذية أحداث طلبات المتجر ومصالحة الانتباه للموظف (ADR-29 §2.4). **قراءة فقط بالكامل.**
 *
 * - `GET commerce/orders/feed?after_seq=&limit=` — صفحة مؤشّر (≤ 100 حدث) بترتيب `feed_seq`؛ ETag/304 (الصفحة المرتبطة بالمؤشّر لا تتغيّر إلا بحدث جديد).
 * - `GET commerce/orders/attention?storefront_id=&limit=` — الطلبات التي تحتاج انتباهاً من الحالة الحالية (شبكة أمان مستقلة عن التغذية).
 *
 * الصلاحية `commerce.orders.view` (owner/admin عبر `*` فقط؛ لا `MATRIX` ولا دور مخزَّن) + `EnsureApplicationActive:commerce.storefront` على المسار. المستخدم المقيَّد
 * بمخازن يُرفض 403 (الطلب `CompanyWide` بلا مخزن فلا نطاق رؤية صحيح) حتى H2-2. كل الاستعلامات تحت `TenantScope`؛ لا يُقبل معرّف مستأجر من العميل.
 * لا كتابة ولا قفل ولا إشعار ولا أثر مالي أو مخزني.
 */
class CommerceStaffOrderFeedController extends ApiController
{
    public function feed(Request $request, CommerceOrderFeedReader $reader): JsonResponse|Response
    {
        $this->guard($request);

        $data = $request->validate([
            'after_seq' => ['sometimes', 'integer', 'min:0', 'max:'.PHP_INT_MAX],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.CommerceOrderFeedReader::MAX_LIMIT],
        ]);
        $after = (int) ($data['after_seq'] ?? 0);
        $limit = (int) ($data['limit'] ?? CommerceOrderFeedReader::MAX_LIMIT);

        $page = $reader->page($after, $limit);

        // ETag قوي بما يحدد الصفحة: لمؤشّر ثابت لا يتغيّر المحتوى إلا حين يُلحَق حدث بصفحة غير ممتلئة (فيتغيّر آخر seq أو العدد).
        $etag = '"cof-'.substr(sha1(implode('|', [app(TenantContext::class)->id(), $after, $page['limit'], $page['next_after_seq'], $page['events']->count(), (int) $page['has_more']])), 0, 32).'"';
        $headers = ['ETag' => $etag, 'Cache-Control' => 'private, no-cache'];
        if (in_array($etag, array_map(fn (string $t) => ltrim($t, 'W/'), $request->getETags()), true)) {
            return response('', 304, $headers);
        }

        return response()->json([
            'data' => $page['events']->map(fn ($e) => CommerceOrderFeedSerializer::event($e, $page['orders'][$e->commerce_order_id] ?? null))->values()->all(),
            'meta' => [
                'after_seq' => $after,
                'next_after_seq' => $page['next_after_seq'],
                'has_more' => $page['has_more'],
                'limit' => $page['limit'],
            ],
        ], 200, $headers);
    }

    public function attention(Request $request, CommerceOrderAttentionQuery $query): JsonResponse
    {
        $this->guard($request);

        $data = $request->validate([
            'storefront_id' => ['sometimes', 'uuid'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.CommerceOrderAttentionQuery::MAX_LIMIT],
        ]);

        $result = $query->run($data['storefront_id'] ?? null, (int) ($data['limit'] ?? CommerceOrderAttentionQuery::DEFAULT_LIMIT));

        return response()->json([
            'data' => $result['orders']->map(fn ($o) => CommerceOrderFeedSerializer::attention($o, $query))->values()->all(),
            'meta' => ['truncated' => $result['truncated'], 'window_hours' => $result['window_hours'], 'limit' => $result['limit']],
        ], 200, ['Cache-Control' => 'private, no-store']);
    }

    private function guard(Request $request): void
    {
        if ($request->user()?->allowedWarehouseIds() !== null) {
            abort(403, 'تغذية طلبات المتجر غير متاحة للمستخدم المقيَّد بمخازن محددة.');
        }
    }
}

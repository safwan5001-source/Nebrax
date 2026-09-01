<?php

namespace App\Support;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Contracts\Support\Arrayable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Str;

/**
 * مُنشئ مغلّف الاستجابة الموحّد للـ Public API (v1).
 *
 * كل استجابة عامة — نجاحًا أو خطأً — تحمل `meta.request_id`. العقد:
 *   نجاح: { "data": …, "meta": { "request_id": "…" } }
 *   خطأ:  { "error": { "code", "message", "details?" }, "meta": { "request_id": "…" } }
 *
 * مستقل تمامًا عن استجابات الـ Internal API؛ لا يُعيد تشكيلها ولا يعتمد عليها.
 * قابل للتوسّع لاحقًا (pagination في meta، includes في data) دون كسر الشكل.
 */
class PublicApiResponse
{
    /** المفتاح الذي يخزّن عليه الوسيط معرّف الطلب لهذا الطلب. */
    public const REQUEST_ID_ATTRIBUTE = 'public_api_request_id';

    /** استجابة نجاح موحّدة. */
    public static function success(Request $request, mixed $data = null, int $status = 200, array $meta = []): JsonResponse
    {
        if ($data instanceof Arrayable) {
            $data = $data->toArray();
        }

        return new JsonResponse([
            // كائن فارغ لا مصفوفة فارغة، فيبقى `data` كائنًا في JSON دائمًا.
            'data' => $data ?? new \stdClass(),
            'meta' => array_merge(['request_id' => self::requestId($request)], $meta),
        ], $status);
    }

    /** استجابة خطأ موحّدة برمز machine-readable مستقر. */
    public static function error(
        Request $request,
        PublicApiErrorCode $code,
        string $message,
        ?int $status = null,
        array $details = [],
    ): JsonResponse {
        $error = ['code' => $code->value, 'message' => $message];
        if ($details !== []) {
            $error['details'] = $details;
        }

        return new JsonResponse([
            'error' => $error,
            'meta'  => ['request_id' => self::requestId($request)],
        ], $status ?? $code->defaultHttpStatus());
    }

    /**
     * استجابة قائمة مقسَّمة (paginated): { data:[…], meta:{ request_id, pagination } }.
     * سقف حجم الصفحة يفرضه المتحكّم؛ هنا نبني العقد فقط. تُحوَّل كل عنصر عبر
     * مورد الـ Public المخصّص (لا يُكشف نموذج Eloquent مباشرة).
     *
     * @param  class-string<JsonResource>  $resourceClass
     */
    public static function paginated(Request $request, LengthAwarePaginator $paginator, string $resourceClass): JsonResponse
    {
        $data = $paginator->getCollection()
            ->map(fn ($model) => (new $resourceClass($model))->resolve($request))
            ->all();

        return new JsonResponse([
            'data' => $data,
            'meta' => [
                'request_id' => self::requestId($request),
                'pagination' => [
                    'page'      => $paginator->currentPage(),
                    'per_page'  => $paginator->perPage(),
                    'total'     => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                    'has_more'  => $paginator->hasMorePages(),
                ],
            ],
        ], 200);
    }

    /** استجابة مورد مفرد عبر مورد Public مخصّص (لا نموذج Eloquent مباشر). */
    public static function resource(Request $request, JsonResource $resource): JsonResponse
    {
        return self::success($request, $resource->resolve($request));
    }

    /**
     * معرّف الطلب المثبَّت من الوسيط. لو غاب (مثلًا خطأ على مسار غير مطابق لم
     * يمرّ عليه الوسيط)، يولّد واحدًا ويثبّته — فيبقى العقد يحمل معرّفًا دائمًا.
     */
    public static function requestId(Request $request): string
    {
        $existing = $request->attributes->get(self::REQUEST_ID_ATTRIBUTE);
        if (is_string($existing) && $existing !== '') {
            return $existing;
        }

        $generated = (string) Str::uuid();
        $request->attributes->set(self::REQUEST_ID_ATTRIBUTE, $generated);

        return $generated;
    }
}

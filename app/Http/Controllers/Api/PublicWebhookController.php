<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PublicStoreWebhookRequest;
use App\Http\Requests\PublicUpdateWebhookRequest;
use App\Http\Resources\PublicWebhookResource;
use App\Models\WebhookEndpoint;
use App\Services\WebhookSubscriptionService;
use App\Support\PublicApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Public API — إدارة اشتراكات الـ Webhooks (PR-7). سطحٌ ضيّق ومتّسق مع بقيّة
 * الـ Public API: مصادقة مفتاح، عزل مستأجر مغلق، scope تام (`webhooks:read/write`)،
 * اشتراك نشط، وعقود الاستجابة/الأخطاء/التدقيق نفسها. لا كتابة مباشرة — عبر الخدمة.
 *
 * **السرّ يُعرَض مرّة واحدة** عند الإنشاء والتدوير فقط، ولا يُعاد بعدها في أيّ قراءة.
 * كلّ المعرّفات تُحلّ ضمن نطاق المستأجر (`findOrFail`)، فمعرّف مستأجر آخر = 404.
 */
class PublicWebhookController extends PublicApiController
{
    private const SORTS = [
        'created_at' => 'created_at',
    ];

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status'   => ['sometimes', 'nullable', 'in:enabled,disabled'],
            'sort'     => ['sometimes', 'nullable', 'string', 'max:40'],
            'page'     => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = WebhookEndpoint::query();

        if (filled($filters['status'] ?? null)) {
            $query->where('status', $filters['status']);
        }

        $this->applySort($query, $filters['sort'] ?? null, self::SORTS, '-created_at');

        return PublicApiResponse::paginated($request, $query->paginate($this->perPage($request)), PublicWebhookResource::class);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        // معزول بالمستأجر: معرّف مستأجر آخر = «غير موجود».
        $endpoint = WebhookEndpoint::findOrFail($id);

        return PublicApiResponse::resource($request, new PublicWebhookResource($endpoint));
    }

    /**
     * ينشئ اشتراكًا. الخادم يولّد السرّ ويعيده **مرّة واحدة** في هذه الاستجابة فقط.
     * المستأجر من مفتاح API المصادَق (لا من الجسم)، وعميل الـ API يُسجَّل كمنشأ.
     */
    public function store(PublicStoreWebhookRequest $request, WebhookSubscriptionService $service): JsonResponse
    {
        $client = $request->user(); // ApiClient (tokenable)
        $input = $request->validated();

        [$endpoint, $secret] = $this->domainWrite(fn () => $service->create(
            (string) $client->tenant_id,
            (string) $client->id,
            $input['url'],
            $input['event_types'],
            $input['description'] ?? null,
        ));

        $data = (new PublicWebhookResource($endpoint))->resolve($request);
        $data['secret'] = $secret; // يُعرَض مرّة واحدة فقط

        return PublicApiResponse::success($request, $data, 201);
    }

    /** تحديث جزئيّ. تغيير العنوان يُعاد تحقّق SSRF له. السرّ لا يتغيّر هنا. */
    public function update(PublicUpdateWebhookRequest $request, string $id, WebhookSubscriptionService $service): JsonResponse
    {
        $endpoint = WebhookEndpoint::findOrFail($id);

        $updated = $this->domainWrite(fn () => $service->update($endpoint, $request->validated()));

        return PublicApiResponse::resource($request, new PublicWebhookResource($updated));
    }

    /** حذف الاشتراك (تسقط تسليماته بالتسلسل). آمن ومعزول بالمستأجر. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $endpoint = WebhookEndpoint::findOrFail($id);
        $endpoint->delete();

        return PublicApiResponse::success($request, ['id' => $id, 'deleted' => true]);
    }

    /** يدوّر السرّ ويعيد الجديد **مرّة واحدة**. التوقيعات بالسرّ القديم تتوقّف فورًا. */
    public function rotateSecret(Request $request, string $id, WebhookSubscriptionService $service): JsonResponse
    {
        $endpoint = WebhookEndpoint::findOrFail($id);
        $secret = $service->rotateSecret($endpoint);

        $data = (new PublicWebhookResource($endpoint))->resolve($request);
        $data['secret'] = $secret; // يُعرَض مرّة واحدة فقط

        return PublicApiResponse::success($request, $data);
    }
}

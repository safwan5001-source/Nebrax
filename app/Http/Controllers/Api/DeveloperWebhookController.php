<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\PublicStoreWebhookRequest;
use App\Http\Requests\PublicUpdateWebhookRequest;
use App\Http\Resources\PublicWebhookResource;
use App\Models\WebhookEndpoint;
use App\Services\WebhookSubscriptionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * إدارة اشتراكات الـ Webhooks لمستأجر أَوْج عبر **الجلسة الداخلية** (PR-7.5).
 *
 * **يعيد استخدام منطق PR-7 بالكامل** دون إعادة بنائه: `WebhookSubscriptionService`
 * (تحقّق SSRF + كتالوج الأحداث + دورة حياة السرّ)، وطلبات التحقّق نفسها
 * (`PublicStoreWebhookRequest`/`PublicUpdateWebhookRequest`)، ومورد العرض المُنتقى
 * (`PublicWebhookResource`, لا يكشف السرّ). الفرق الوحيد الغلاف: مصادقة الجلسة
 * الداخلية + `EnsureUserPrincipal` + RBAC، واستجابات داخلية `{data}` — لا مفتاح
 * Public API في المتصفّح. السرّ الخام يُعرَض **مرّة واحدة** عند الإنشاء/التدوير.
 */
class DeveloperWebhookController extends Controller
{
    public function index(): JsonResponse
    {
        // معزول بالمستأجر (BaseModel + SetTenant)؛ عددها محدود بسقف المؤسسة.
        $endpoints = WebhookEndpoint::query()->orderByDesc('created_at')->get();

        return PublicWebhookResource::collection($endpoints)->response();
    }

    public function show(string $endpoint): JsonResponse
    {
        $model = WebhookEndpoint::query()->findOrFail($endpoint);

        return (new PublicWebhookResource($model))->response();
    }

    public function store(PublicStoreWebhookRequest $request, WebhookSubscriptionService $service): JsonResponse
    {
        $input = $request->validated();

        try {
            [$endpoint, $secret] = $service->create(
                (string) $request->user()->tenant_id, // المستأجر من الجلسة
                null,                                  // منشأ داخلي (لا عميل API)
                $input['url'],
                $input['event_types'],
                $input['description'] ?? null,
            );
        } catch (RuntimeException $e) {
            // حدّ الاشتراكات (SSRF/الكتالوج التُقطا في التحقّق مسبقًا) ⇒ 422 نظيفة.
            abort(422, $e->getMessage());
        }

        return response()->json([
            'secret'  => $secret, // يُعرَض مرّة واحدة فقط
            'webhook' => (new PublicWebhookResource($endpoint))->resolve(request()),
        ], 201);
    }

    public function update(PublicUpdateWebhookRequest $request, string $endpoint, WebhookSubscriptionService $service): JsonResponse
    {
        $model = WebhookEndpoint::query()->findOrFail($endpoint);

        try {
            $updated = $service->update($model, $request->validated());
        } catch (RuntimeException $e) {
            abort(422, $e->getMessage());
        }

        return (new PublicWebhookResource($updated))->response();
    }

    public function destroy(string $endpoint): JsonResponse
    {
        $model = WebhookEndpoint::query()->findOrFail($endpoint);
        $model->delete(); // تسقط تسليماته بالتسلسل

        return response()->json(['message' => 'تم حذف اشتراك الـ Webhook.']);
    }

    public function rotateSecret(string $endpoint, WebhookSubscriptionService $service): JsonResponse
    {
        $model = WebhookEndpoint::query()->findOrFail($endpoint);
        $secret = $service->rotateSecret($model);

        return response()->json([
            'secret'  => $secret, // يُعرَض مرّة واحدة فقط
            'webhook' => (new PublicWebhookResource($model))->resolve(request()),
        ]);
    }
}

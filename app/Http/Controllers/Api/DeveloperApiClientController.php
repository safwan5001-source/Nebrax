<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\IssueDeveloperApiKeyRequest;
use App\Http\Requests\StoreDeveloperApiClientRequest;
use App\Http\Resources\DeveloperApiClientResource;
use App\Http\Resources\DeveloperApiKeyResource;
use App\Models\ApiClient;
use App\Services\ApiClientKeyService;
use App\Support\PublicApiScope;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\NewAccessToken;

/**
 * إدارة عملاء Public API ومفاتيحهم لمستأجر أَوْج عبر **الجلسة الداخلية** (PR-7.5).
 *
 * سطح إدارة داخلي (لا Public API): يعيد استخدام `ApiClientKeyService` القائم دون
 * إعادة بناء دورة حياة المفاتيح. مصادقة الجلسة + `EnsureUserPrincipal` (لا توكن
 * ApiClient) + `SetTenant` + RBAC (`developer.view`/`developer.manage`). كل استعلام
 * معزول بالمستأجر (`ApiClient` يرث `BaseModel`)، فمعرّف مستأجر آخر = 404. **لا تُعاد
 * التجزئة ولا النصّ الصريح للمفتاح** إلا مرّة واحدة عند الإصدار.
 */
class DeveloperApiClientController extends Controller
{
    public function index(): JsonResponse
    {
        $clients = ApiClient::query()->with('tokens')->orderByDesc('created_at')->get();

        return DeveloperApiClientResource::collection($clients)->response();
    }

    public function show(string $apiClient): JsonResponse
    {
        // معزول بالمستأجر: معرّف مستأجر آخر ⇒ 404 (لا كشف وجود).
        $client = ApiClient::query()->with('tokens')->findOrFail($apiClient);

        return (new DeveloperApiClientResource($client))->response();
    }

    /** ينشئ عميلًا ويُصدر مفتاحه الأوّل (النصّ الصريح مرّة واحدة). */
    public function store(StoreDeveloperApiClientRequest $request, ApiClientKeyService $service): JsonResponse
    {
        $input = $request->validated();
        $tenant = $request->user()->tenant; // المستأجر من الجلسة، لا من الجسم

        $client = $service->createClient($tenant, $input['name']);
        $key = $service->issueKey($client, 'default', PublicApiScope::sanitize($input['scopes']), $this->expiry($input));

        return $this->issuedResponse($client->load('tokens'), $key, 201);
    }

    /** يُصدر مفتاحًا إضافيًا لعميل قائم (النصّ الصريح مرّة واحدة). */
    public function issueKey(IssueDeveloperApiKeyRequest $request, string $apiClient, ApiClientKeyService $service): JsonResponse
    {
        $client = ApiClient::query()->findOrFail($apiClient);
        $input = $request->validated();

        $key = $service->issueKey($client, $input['name'] ?? 'key', PublicApiScope::sanitize($input['scopes']), $this->expiry($input));

        return $this->issuedResponse($client->load('tokens'), $key, 201);
    }

    /** يُبطل مفتاحًا واحدًا يخصّ هذا العميل حصرًا (تحقّق ملكية قبل الإبطال). */
    public function revokeKey(string $apiClient, string $tokenId, ApiClientKeyService $service): JsonResponse
    {
        $client = ApiClient::query()->findOrFail($apiClient);

        if (! $client->tokens()->whereKey($tokenId)->exists()) {
            abort(404, 'المفتاح غير موجود لهذا العميل.');
        }

        $service->revokeKey($client, $tokenId);

        return response()->json(['message' => 'تم إبطال المفتاح.']);
    }

    /** يُعطّل العميل (تُرفض كل مفاتيحه عند المصادقة). دورة الحياة القانونية: تعطيل لا حذف. */
    public function deactivate(string $apiClient, ApiClientKeyService $service): JsonResponse
    {
        $client = ApiClient::query()->findOrFail($apiClient);
        $service->deactivateClient($client);

        return (new DeveloperApiClientResource($client->fresh()->load('tokens')))->response();
    }

    /** @param array<string,mixed> $input */
    private function expiry(array $input): ?\Illuminate\Support\Carbon
    {
        return isset($input['expires_in_days']) && $input['expires_in_days'] !== null
            ? now()->addDays((int) $input['expires_in_days'])
            : null;
    }

    /**
     * استجابة إصدار مفتاح: تفصل **النصّ الصريح لمرّة واحدة** (`secret`) عن البيانات
     * الوصفية الدائمة (`key`, `client`). لا يُخزَّن الصريح ولا يُسجَّل ولا يُعاد لاحقًا.
     */
    private function issuedResponse(ApiClient $client, NewAccessToken $key, int $status): JsonResponse
    {
        return response()->json([
            'secret' => $key->plainTextToken,
            'key'    => (new DeveloperApiKeyResource($key->accessToken))->resolve(request()),
            'client' => (new DeveloperApiClientResource($client))->resolve(request()),
        ], $status);
    }
}

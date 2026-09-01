<?php

namespace App\Services;

use App\Models\ApiClient;
use App\Models\Tenant;
use App\Support\PublicApiScope;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\NewAccessToken;

/**
 * أساس دورة حياة عملاء ومفاتيح الـ Public API (خدمة نطاق، لا سطح HTTP في PR-2).
 *
 * مفاتيح الـ API = توكنات Sanctum (tokenable = ApiClient): **لا تشفير مخصّص** —
 * توليد آمن (Str::random) + تجزئة sha256 مخزَّنة، والنصّ الصريح يُعاد **مرة واحدة**
 * وقت الإنشاء فقط، ولا يُخزَّن ولا يُسجَّل. الـ scopes تُحقَّق ضد سجلّ ثابت
 * (`PublicApiScope`) فيرفض المجهول و`*`.
 */
class ApiClientKeyService
{
    /** ينشئ عميل API مملوكًا لمستأجر. */
    public function createClient(Tenant $tenant, string $name, bool $active = true): ApiClient
    {
        return ApiClient::create([
            'tenant_id' => $tenant->id,
            'name'      => $name,
            'is_active' => $active,
        ]);
    }

    /**
     * يصدر مفتاحًا للعميل بقائمة scopes محقَّقة. يُعيد `NewAccessToken` الحامل
     * للنصّ الصريح (`plainTextToken`) الذي يُعرَض مرّة واحدة فقط.
     *
     * @param  array<int, string>  $scopes
     */
    public function issueKey(ApiClient $client, string $name, array $scopes, ?Carbon $expiresAt = null): NewAccessToken
    {
        $abilities = PublicApiScope::sanitize($scopes); // يرفض المجهول و`*`

        return $client->createToken($name, $abilities, $expiresAt);
    }

    /**
     * يدوّر مفتاحًا: يصدر جديدًا ويترك القديم صالحًا **للتداخل الآمن** (بلا انقطاع)،
     * فيهاجر التكامل إلى الجديد ثم يُبطَل القديم عبر `revokeKey`. (Sanctum يسمح
     * بعدة مفاتيح للعميل، فالتداخل طبيعي.)
     *
     * @param  array<int, string>  $scopes
     */
    public function rotateKey(ApiClient $client, string $name, array $scopes, ?Carbon $expiresAt = null): NewAccessToken
    {
        return $this->issueKey($client, $name, $scopes, $expiresAt);
    }

    /** يُبطل مفتاحًا واحدًا فورًا (حذف التوكن) — يتعذّر مصادقته بعدها. */
    public function revokeKey(ApiClient $client, int|string $tokenId): void
    {
        // مقيَّد بمفاتيح هذا العميل: لا يمكن إبطال مفتاح عميل آخر (عزل الإدارة).
        $client->tokens()->whereKey($tokenId)->delete();
    }

    /** يعطّل العميل: تُرفض كل مفاتيحه عند المصادقة (fail-closed على `is_active`). */
    public function deactivateClient(ApiClient $client): void
    {
        $client->forceFill(['is_active' => false])->save();
    }
}

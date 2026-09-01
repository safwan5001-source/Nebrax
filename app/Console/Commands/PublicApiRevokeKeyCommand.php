<?php

namespace App\Console\Commands;

use App\Models\ApiClient;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantScope;
use Illuminate\Console\Command;
use Illuminate\Support\Str;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * أداة تشغيل: إبطال مفتاح Public API واحد فورًا (حذف التوكن) — لا يمكن مصادقته
 * بعدها. للاستجابة السريعة عند تسريب مفتاح. يُقيَّد الإبطال بمفاتيح العميل المحدَّد.
 */
class PublicApiRevokeKeyCommand extends Command
{
    protected $signature = 'public-api:revoke-key
        {client : معرّف عميل الـ API (UUID)}
        {token : معرّف التوكن (الجزء قبل | في المفتاح)}';

    protected $description = 'إبطال مفتاح Public API واحد (حذف توكن Sanctum).';

    public function handle(ApiClientKeyService $service): int
    {
        $clientId = (string) $this->argument('client');
        if (! Str::isUuid($clientId)) {
            $this->error('معرّف العميل يجب أن يكون UUID.');

            return self::FAILURE;
        }

        // أداة تشغيل خادمية: نتجاوز نطاق المستأجر (لا سياق في CLI)، مقيَّدين بالعميل المحدَّد.
        $client = ApiClient::withoutGlobalScope(TenantScope::class)->find($clientId);
        if ($client === null) {
            $this->error('عميل الـ API غير موجود.');

            return self::FAILURE;
        }

        $exists = PersonalAccessToken::query()
            ->whereKey($this->argument('token'))
            ->where('tokenable_type', ApiClient::class)
            ->where('tokenable_id', $client->id)
            ->exists();

        if (! $exists) {
            $this->error('التوكن غير موجود لهذا العميل.');

            return self::FAILURE;
        }

        $service->revokeKey($client, (int) $this->argument('token'));
        $this->info('تم إبطال المفتاح.');

        return self::SUCCESS;
    }
}

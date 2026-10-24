<?php

namespace Tests\Feature;

use App\Models\PaymentGateway;
use App\Models\Tenant;
use App\Services\PaymentGatewayService;
use App\Tenancy\TenantContext;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Encryption\Encrypter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Crypt;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/** PAY-H8-01 / D-10 (R-23): تدوير مفتاح التطبيق عبر `APP_PREVIOUS_KEYS` لا يكسر فك أسرار الاتصالات؛ وبدونه يفشل فشلاً صريحاً لا صامتاً. */
class PaymentCredentialKeyRotationTest extends TestCase
{
    use RefreshDatabase;

    private function rotateAppKey(string $newKey, array $previous): void
    {
        config(['app.key' => $newKey, 'app.previous_keys' => $previous]);
        $this->app->forgetInstance('encrypter');
        Crypt::clearResolvedInstance('encrypter');
    }

    #[Test]
    public function secrets_survive_an_app_key_rotation_only_when_the_previous_key_is_declared(): void
    {
        $tenant = Tenant::create(['name' => 'شركة التدوير', 'slug' => 'key-rotation', 'vat_number' => '300000000000013', 'currency' => 'SAR']);
        app(TenantContext::class)->set($tenant->id);
        $service = app(PaymentGatewayService::class);
        $gateway = $service->create(['provider' => 'custom', 'name' => 'تدوير', 'secret_key' => 'sk_rotation_secret', 'webhook_secret' => 'whsec_rotation_secret']);

        $oldKey = (string) config('app.key');
        $newKey = 'base64:'.base64_encode(Encrypter::generateKey(config('app.cipher')));

        // مفتاح جديد بلا إعلان السابق ⇒ فشل صريح (لا قيمة فارغة صامتة)
        $this->rotateAppKey($newKey, []);
        $threw = false;
        try {
            $service->providerCredentials(PaymentGateway::query()->findOrFail($gateway->id));
        } catch (DecryptException) {
            $threw = true;
        }
        $this->assertTrue($threw, 'فك السر بمفتاح غير معلن السابق يفشل صراحةً');

        // مع إعلان المفتاح السابق ⇒ يُفك كما كان
        $this->rotateAppKey($newKey, [$oldKey]);
        $credentials = $service->providerCredentials(PaymentGateway::query()->findOrFail($gateway->id));
        $this->assertSame('sk_rotation_secret', $credentials['secret_key']);
        $this->assertSame('whsec_rotation_secret', $credentials['webhook_secret']);
    }
}

<?php

namespace App\Services;

use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Collection;

/**
 * أساس إعداد بوابات الدفع للمستأجر.
 *
 * لا يستدعي مزوّداً، لا ينشئ PaymentIntent، لا يعالج Webhook،
 * ولا يكتب قيداً محاسبياً. PaymentMethod يبقى البيان التشغيلي الوحيد.
 */
final class PaymentGatewayService
{
    public function __construct(private readonly TenantContext $tenantContext)
    {
    }

    /** @return Collection<int, PaymentGateway> */
    public function list(): Collection
    {
        $this->requireTenant();

        return PaymentGateway::query()->orderBy('name')->get();
    }

    public function find(string $id): PaymentGateway
    {
        $this->requireTenant();

        return PaymentGateway::query()->findOrFail($id);
    }

    /** @param array<string, mixed> $input */
    public function create(array $input): PaymentGateway
    {
        $tenantId = $this->requireTenant();
        $payload = $this->normalize($input);
        $this->assertNameFree($payload['name']);

        $gateway = new PaymentGateway();
        $gateway->forceFill([
            'tenant_id' => $tenantId,
            'provider' => $payload['provider'],
            'name' => $payload['name'],
            'name_en' => $payload['name_en'],
            'environment' => $payload['environment'],
            'is_active' => $payload['is_active'],
            'merchant_reference' => $payload['merchant_reference'],
            'publishable_key' => $payload['publishable_key'],
            'secret_key' => $payload['secret_key'],
            'webhook_secret' => $payload['webhook_secret'],
            'extra_credentials' => $payload['extra_credentials'],
            'payment_method_id' => $payload['payment_method_id'],
        ])->save();

        return $gateway;
    }

    /** @param array<string, mixed> $input */
    public function update(PaymentGateway $gateway, array $input): PaymentGateway
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);

        $payload = $this->normalize($input, $gateway);
        $this->assertNameFree($payload['name'], $gateway->id);

        $gateway->fill([
            'provider' => $payload['provider'],
            'name' => $payload['name'],
            'name_en' => $payload['name_en'],
            'environment' => $payload['environment'],
            'is_active' => $payload['is_active'],
            'merchant_reference' => $payload['merchant_reference'],
            'publishable_key' => $payload['publishable_key'],
            'payment_method_id' => $payload['payment_method_id'],
        ]);

        if (array_key_exists('secret_key', $input)) {
            $gateway->secret_key = $this->nullableString($input['secret_key']);
        }
        if (array_key_exists('webhook_secret', $input)) {
            $gateway->webhook_secret = $this->nullableString($input['webhook_secret']);
        }
        if (array_key_exists('extra_credentials', $input)) {
            $gateway->extra_credentials = $this->normalizeExtra($input['extra_credentials']);
        }

        $gateway->save();

        return $gateway->fresh();
    }

    public function delete(PaymentGateway $gateway): void
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);
        $gateway->delete();
    }

    /**
     * يفكّ الأسرار للاستخدام الداخلي اللاحق من محوّل مزوّد فقط.
     * لا يُستدعى من مورد API أو سجل أو واجهة.
     *
     * @return array{secret_key: ?string, webhook_secret: ?string, extra_credentials: ?array}
     */
    public function providerCredentials(PaymentGateway $gateway): array
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);

        return [
            'secret_key' => $gateway->secret_key,
            'webhook_secret' => $gateway->webhook_secret,
            'extra_credentials' => is_array($gateway->extra_credentials) ? $gateway->extra_credentials : null,
        ];
    }

    private function requireTenant(): string
    {
        $tenantId = $this->tenantContext->id();

        if ($tenantId === null) {
            throw new DomainException('Tenant context is required for payment gateway configuration.');
        }

        return $tenantId;
    }

    private function assertSameTenant(string $tenantId, PaymentGateway $gateway): void
    {
        if ((string) $gateway->tenant_id !== $tenantId) {
            throw new DomainException('Payment gateway must belong to the active tenant.');
        }
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array{
     *     provider: string,
     *     name: string,
     *     name_en: ?string,
     *     environment: string,
     *     is_active: bool,
     *     merchant_reference: ?string,
     *     publishable_key: ?string,
     *     secret_key: ?string,
     *     webhook_secret: ?string,
     *     extra_credentials: ?array,
     *     payment_method_id: ?string
     * }
     */
    private function normalize(array $input, ?PaymentGateway $current = null): array
    {
        $provider = strtolower(trim((string) $this->value($input, $current, 'provider', '')));
        if (! in_array($provider, PaymentGateway::PROVIDERS, true)) {
            throw new DomainException('Unsupported payment gateway provider.');
        }

        $environment = strtolower(trim((string) $this->value($input, $current, 'environment', PaymentGateway::ENVIRONMENT_SANDBOX)));
        if (! in_array($environment, PaymentGateway::ENVIRONMENTS, true)) {
            throw new DomainException('Payment gateway environment must be sandbox or live.');
        }

        $name = trim((string) $this->value($input, $current, 'name', ''));
        if ($name === '') {
            throw new DomainException('Payment gateway name is required.');
        }

        $paymentMethodId = $this->nullableString($this->value($input, $current, 'payment_method_id', null));
        if ($paymentMethodId !== null) {
            $this->assertLocalPaymentMethod($paymentMethodId);
        }

        $extra = array_key_exists('extra_credentials', $input)
            ? $this->normalizeExtra($input['extra_credentials'])
            : ($current?->extra_credentials);

        return [
            'provider' => $provider,
            'name' => $name,
            'name_en' => $this->nullableString($this->value($input, $current, 'name_en', null)),
            'environment' => $environment,
            'is_active' => (bool) $this->value($input, $current, 'is_active', true),
            'merchant_reference' => $this->nullableString($this->value($input, $current, 'merchant_reference', null)),
            'publishable_key' => $this->nullableString($this->value($input, $current, 'publishable_key', null)),
            'secret_key' => array_key_exists('secret_key', $input)
                ? $this->nullableString($input['secret_key'])
                : $current?->secret_key,
            'webhook_secret' => array_key_exists('webhook_secret', $input)
                ? $this->nullableString($input['webhook_secret'])
                : $current?->webhook_secret,
            'extra_credentials' => is_array($extra) ? $extra : null,
            'payment_method_id' => $paymentMethodId,
        ];
    }

    private function assertLocalPaymentMethod(string $paymentMethodId): void
    {
        $method = PaymentMethod::query()->whereKey($paymentMethodId)->first();
        if ($method === null) {
            throw new DomainException('Payment method must belong to the active tenant.');
        }
    }

    private function assertNameFree(string $name, ?string $exceptId = null): void
    {
        $query = PaymentGateway::query()->where('name', $name);
        if ($exceptId !== null) {
            $query->whereKeyNot($exceptId);
        }
        if ($query->exists()) {
            throw new DomainException('A payment gateway with this name already exists.');
        }
    }

    /** @param array<string, mixed> $input */
    private function value(array $input, ?PaymentGateway $current, string $key, mixed $default): mixed
    {
        if (array_key_exists($key, $input)) {
            return $input[$key];
        }

        return $current?->{$key} ?? $default;
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $text = trim((string) $value);

        return $text === '' ? null : $text;
    }

    private function normalizeExtra(mixed $value): ?array
    {
        if ($value === null || $value === []) {
            return null;
        }
        if (! is_array($value)) {
            throw new DomainException('Gateway extra credentials must be an object of key/value secrets.');
        }

        $clean = [];
        foreach ($value as $key => $item) {
            if (! is_string($key) || $key === '' || ! is_scalar($item)) {
                throw new DomainException('Gateway extra credentials must be string keys with scalar values.');
            }
            $clean[$key] = is_string($item) ? $item : (string) $item;
        }

        return $clean === [] ? null : $clean;
    }
}

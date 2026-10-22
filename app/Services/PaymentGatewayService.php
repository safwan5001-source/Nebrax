<?php

namespace App\Services;

use App\Models\PaymentConnectionEvent;
use App\Models\PaymentGateway;
use App\Models\PaymentMethod;
use App\Models\User;
use App\Support\PaymentGatewayException;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;

/**
 * إدارة اتصال بوابة الدفع للمستأجر: الإعداد، دورة الحياة، تدوير الأسرار، وسجل التدقيق.
 *
 * لا يستدعي مزوّداً، لا ينشئ PaymentIntent، لا يعالج Webhook،
 * ولا يكتب قيداً محاسبياً. PaymentMethod يبقى البيان التشغيلي الوحيد.
 *
 * كل تغيير حالة أو أسرار داخل معاملة بقفل صفّ، ويكتب حدث تدقيق append-only (بلا أسرار).
 * التفعيل الأول لمزوّد حقيقي يتطلب `verified_at` ولا يضبطه إلا التحقق بمحوّل المزوّد (شريحة
 * لاحقة)، فلا يصير أي اتصال حقيقي `active` قبل ذلك؛ مزوّد `custom` (ربط محاسبي يدوي بلا
 * استدعاء مزوّد) يُفعَّل مباشرة.
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
    public function create(array $input, ?User $actor = null): PaymentGateway
    {
        $tenantId = $this->requireTenant();
        $payload = $this->normalize($input);
        $this->assertNameFree($payload['name']);

        return DB::transaction(function () use ($tenantId, $payload, $actor): PaymentGateway {
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
                'status' => PaymentGateway::STATUS_DRAFT,
                'connection_mode' => PaymentGateway::MODE_BYOG,
                'credential_version' => 1,
            ])->save();

            $this->record($gateway, 'created', null, PaymentGateway::STATUS_DRAFT, $actor);

            return $gateway->fresh();
        });
    }

    /**
     * تعديل الحقول غير السرّية. المزوّد ثابت بعد الإنشاء، والبيئة تتغيّر في المسودة وحدها،
     * والاتصال الملغى لا يُعدَّل. مفاتيح الأسرار إن وُجدت في المدخل تمرّ بمسار التدوير نفسه
     * (إصدار + تدقيق) لا بكتابة صامتة.
     *
     * @param array<string, mixed> $input
     */
    public function update(PaymentGateway $gateway, array $input, ?User $actor = null): PaymentGateway
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);

        return DB::transaction(function () use ($gateway, $input, $actor): PaymentGateway {
            $locked = $this->lock($gateway);
            $this->assertNotRevoked($locked);

            $payload = $this->normalize($input, $locked);
            if ($payload['provider'] !== $locked->provider) {
                throw new PaymentGatewayException('gateway.provider_immutable', 'لا يمكن تغيير مزوّد اتصال قائم. أنشئ اتصالاً جديداً.');
            }
            if ($payload['environment'] !== $locked->environment && $locked->status !== PaymentGateway::STATUS_DRAFT) {
                throw new PaymentGatewayException('gateway.environment_locked', 'لا تتغيّر بيئة الاتصال (تجريبي/حي) بعد مغادرة المسودة.');
            }
            $this->assertNameFree($payload['name'], $locked->id);

            $locked->fill([
                'name' => $payload['name'],
                'name_en' => $payload['name_en'],
                'environment' => $payload['environment'],
                'is_active' => $payload['is_active'],
                'merchant_reference' => $payload['merchant_reference'],
                'publishable_key' => $payload['publishable_key'],
                'payment_method_id' => $payload['payment_method_id'],
            ]);
            $changed = array_keys($locked->getDirty());
            $locked->save();

            if ($changed !== []) {
                $this->record($locked, 'updated', $locked->status, $locked->status, $actor, null, $changed);
            }

            $credentialInput = array_intersect_key($input, array_flip(['secret_key', 'webhook_secret', 'extra_credentials']));
            if ($credentialInput !== []) {
                $this->applyCredentials($locked, $credentialInput, 0, $actor);
            }

            return $locked->fresh();
        });
    }

    /**
     * تدوير الأسرار: سرّ جديد للبوابة و/أو للـwebhook و/أو بيانات إضافية. السر السابق للـwebhook
     * يبقى مقبولاً للتحقق خلال `$graceMinutes` فقط (0 = فوراً، مثلاً عند الاشتباه بتسرب).
     * تدوير بيانات اعتماد المزوّد يمسح `verified_at` (تحتاج التحقق من جديد).
     *
     * @param array<string, mixed> $input
     */
    public function rotateCredentials(PaymentGateway $gateway, array $input, int $graceMinutes = 60, ?User $actor = null): PaymentGateway
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);

        $credentialInput = array_intersect_key($input, array_flip(['secret_key', 'webhook_secret', 'extra_credentials']));
        if ($credentialInput === []) {
            throw new PaymentGatewayException('gateway.nothing_to_rotate', 'لم يُرسل أي سرّ للتدوير.');
        }
        if ($graceMinutes < 0 || $graceMinutes > 10080) {
            throw new PaymentGatewayException('gateway.invalid_grace', 'مدة السماح بين 0 و10080 دقيقة.');
        }

        return DB::transaction(function () use ($gateway, $credentialInput, $graceMinutes, $actor): PaymentGateway {
            $locked = $this->lock($gateway);
            $this->assertNotRevoked($locked);

            if ($this->applyCredentials($locked, $credentialInput, $graceMinutes, $actor) === []) {
                throw new PaymentGatewayException('gateway.nothing_to_rotate', 'القيم المرسلة مطابقة للمحفوظة؛ لا شيء للتدوير.');
            }

            return $locked->fresh();
        });
    }

    /** تفعيل: من مسودة أو موقوف. لمزوّد حقيقي يتطلب `verified_at`؛ `custom` بلا تحقق. */
    public function activate(PaymentGateway $gateway, ?User $actor = null, ?string $reason = null): PaymentGateway
    {
        return $this->transition($gateway, PaymentGateway::STATUS_ACTIVE, $actor, $reason);
    }

    /** إيقاف مؤقت قابل للعكس: لا محاولات جديدة، وتبقى السندات والتسويات القائمة. */
    public function suspend(PaymentGateway $gateway, ?User $actor = null, ?string $reason = null): PaymentGateway
    {
        return $this->transition($gateway, PaymentGateway::STATUS_SUSPENDED, $actor, $reason);
    }

    /** إلغاء اعتماد نهائي: تُمحى الأسرار المحفوظة ويبقى الاتصال مرجعاً تاريخياً. السبب إلزامي. */
    public function revoke(PaymentGateway $gateway, ?User $actor = null, ?string $reason = null): PaymentGateway
    {
        return $this->transition($gateway, PaymentGateway::STATUS_REVOKED, $actor, $reason);
    }

    /**
     * حذف فعلي لاتصال غير مرجعي وغير مفعّل فقط. ما له سند أو تسوية يُلغى اعتماده (revoke) ولا يُحذف،
     * كي لا يُمحى ربط مالي تاريخي (`payments.payment_gateway_id`).
     */
    public function delete(PaymentGateway $gateway, ?User $actor = null): void
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);

        DB::transaction(function () use ($gateway, $actor): void {
            $locked = $this->lock($gateway);

            if ($locked->hasFinancialReferences()) {
                throw new PaymentGatewayException(
                    'gateway.has_references',
                    'لا يمكن حذف بوابة مرتبطة بسندات أو تسويات. ألغِ اعتمادها بدلاً من ذلك.'
                );
            }
            if ($locked->status === PaymentGateway::STATUS_ACTIVE) {
                throw new PaymentGatewayException('gateway.active_cannot_delete', 'أوقف الاتصال المفعّل قبل حذفه.');
            }

            $this->record($locked, 'deleted', $locked->status, null, $actor);
            $locked->delete();
        });
    }

    /** @return Collection<int, PaymentConnectionEvent> */
    public function events(PaymentGateway $gateway): Collection
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);

        return PaymentConnectionEvent::query()
            ->where('payment_gateway_id', $gateway->id)
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->get();
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

    private function lock(PaymentGateway $gateway): PaymentGateway
    {
        return PaymentGateway::query()->whereKey($gateway->getKey())->lockForUpdate()->firstOrFail();
    }

    private function assertNotRevoked(PaymentGateway $gateway): void
    {
        if ($gateway->status === PaymentGateway::STATUS_REVOKED) {
            throw new PaymentGatewayException('gateway.revoked', 'الاتصال ملغى الاعتماد ولا يقبل تعديلاً.');
        }
    }

    private function transition(PaymentGateway $gateway, string $target, ?User $actor, ?string $reason): PaymentGateway
    {
        $tenantId = $this->requireTenant();
        $this->assertSameTenant($tenantId, $gateway);
        $reason = $this->nullableString($reason);

        if ($target === PaymentGateway::STATUS_REVOKED && $reason === null) {
            throw new PaymentGatewayException('gateway.reason_required', 'سبب إلغاء الاعتماد إلزامي.');
        }

        return DB::transaction(function () use ($gateway, $target, $actor, $reason): PaymentGateway {
            $locked = $this->lock($gateway);
            $from = $locked->status;

            if ($from === $target) {
                return $locked; // idempotent: لا حدث ولا تغيير
            }
            $this->assertNotRevoked($locked);

            $now = now();
            $extra = [];
            switch ($target) {
                case PaymentGateway::STATUS_ACTIVE:
                    if ($locked->provider !== PaymentGateway::PROVIDER_CUSTOM && $locked->verified_at === null) {
                        throw new PaymentGatewayException(
                            'gateway.verification_required',
                            'لا يُفعَّل اتصال مزوّد حقيقي قبل التحقق من بيانات اعتماده بمحوّل المزوّد.'
                        );
                    }
                    $locked->status = PaymentGateway::STATUS_ACTIVE;
                    $locked->is_active = true;
                    $locked->activated_at ??= $now;
                    $locked->deactivated_at = null;
                    $eventType = $from === PaymentGateway::STATUS_SUSPENDED ? 'reactivated' : 'activated';
                    break;

                case PaymentGateway::STATUS_SUSPENDED:
                    if ($from !== PaymentGateway::STATUS_ACTIVE) {
                        throw new PaymentGatewayException('gateway.not_active', 'الإيقاف المؤقت لاتصال مفعّل فقط.');
                    }
                    $locked->status = PaymentGateway::STATUS_SUSPENDED;
                    $locked->is_active = false;
                    $locked->deactivated_at = $now;
                    $eventType = 'suspended';
                    break;

                default: // revoked
                    $locked->status = PaymentGateway::STATUS_REVOKED;
                    $locked->is_active = false;
                    $locked->deactivated_at = $now;
                    $locked->secret_key = null;
                    $locked->webhook_secret = null;
                    $locked->previous_webhook_secret = null;
                    $locked->previous_secret_expires_at = null;
                    $locked->extra_credentials = null;
                    $locked->credential_version = $locked->credential_version + 1;
                    $eventType = 'revoked';
                    $extra = ['credentials_erased'];
            }

            $locked->save();
            $this->record($locked, $eventType, $from, $locked->status, $actor, $reason, $extra ?: null);

            return $locked->fresh();
        });
    }

    /**
     * يطبّق تغيير الأسرار على الصف المقفول ويسجّل حدثاً. يعيد أسماء ما تغيّر فعلاً.
     *
     * @param  array<string, mixed>  $input
     * @return list<string>
     */
    private function applyCredentials(PaymentGateway $gateway, array $input, int $graceMinutes, ?User $actor): array
    {
        $rotated = [];

        if (array_key_exists('webhook_secret', $input)) {
            $new = $this->nullableString($input['webhook_secret']);
            $current = $gateway->webhook_secret;
            if ($new !== $current) {
                if ($new !== null && filled($current) && $graceMinutes > 0) {
                    $gateway->previous_webhook_secret = $current;
                    $gateway->previous_secret_expires_at = now()->addMinutes($graceMinutes);
                } else {
                    $gateway->previous_webhook_secret = null;
                    $gateway->previous_secret_expires_at = null;
                }
                $gateway->webhook_secret = $new;
                $rotated[] = 'webhook_secret';
            }
        }
        if (array_key_exists('secret_key', $input)) {
            $new = $this->nullableString($input['secret_key']);
            if ($new !== $gateway->secret_key) {
                $gateway->secret_key = $new;
                $rotated[] = 'secret_key';
            }
        }
        if (array_key_exists('extra_credentials', $input)) {
            $new = $this->normalizeExtra($input['extra_credentials']);
            if ($new !== $gateway->extra_credentials) {
                $gateway->extra_credentials = $new;
                $rotated[] = 'extra_credentials';
            }
        }

        if ($rotated === []) {
            return [];
        }

        $gateway->credential_version = $gateway->credential_version + 1;
        if ($gateway->provider !== PaymentGateway::PROVIDER_CUSTOM
            && (in_array('secret_key', $rotated, true) || in_array('extra_credentials', $rotated, true))) {
            $gateway->verified_at = null;
        }
        $gateway->save();

        $this->record($gateway, 'credentials_rotated', $gateway->status, $gateway->status, $actor, null, $rotated);

        return $rotated;
    }

    /**
     * @param list<string>|null $changedFields أسماء الحقول فقط، لا قيم
     */
    private function record(
        PaymentGateway $gateway,
        string $type,
        ?string $from,
        ?string $to,
        ?User $actor,
        ?string $reason = null,
        ?array $changedFields = null,
    ): void {
        PaymentConnectionEvent::create([
            'payment_gateway_id' => $gateway->id,
            'provider' => $gateway->provider,
            'gateway_name' => $gateway->name,
            'event_type' => $type,
            'from_status' => $from,
            'to_status' => $to,
            'credential_version' => $gateway->credential_version,
            'actor_user_id' => $actor?->id,
            'reason' => $reason,
            'changed_fields' => $changedFields,
        ]);
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
            throw new PaymentGatewayException('gateway.unsupported_provider', 'Unsupported payment gateway provider.');
        }

        $environment = strtolower(trim((string) $this->value($input, $current, 'environment', PaymentGateway::ENVIRONMENT_SANDBOX)));
        if (! in_array($environment, PaymentGateway::ENVIRONMENTS, true)) {
            throw new PaymentGatewayException('gateway.invalid_environment', 'Payment gateway environment must be sandbox or live.');
        }

        $name = trim((string) $this->value($input, $current, 'name', ''));
        if ($name === '') {
            throw new PaymentGatewayException('gateway.name_required', 'Payment gateway name is required.');
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
            throw new PaymentGatewayException('gateway.name_taken', 'A payment gateway with this name already exists.');
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

<?php

namespace App\Services\DeliveryHub;

use App\Models\Branch;
use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryPlatformProfile;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * إعداد ربط الموصّل. السر يُولَّد على الخادم ويُعاد مرة واحدة، ويُخزَّن
 * مشفَّراً. لا يُفعّل مزوّداً ولا ينشئ فاتورة.
 */
class DeliveryConnectorAccountService
{
    private const SECRET_PREFIX = 'dsec_';

    /**
     * @param  array{delivery_platform_profile_id: string, external_store_id: string, branch_id?: ?string}  $input
     * @return array{0: DeliveryConnectorAccount, 1: string}
     */
    public function create(User $actor, array $input): array
    {
        $this->assertTenant();
        $profile = $this->profileOrFail((string) $input['delivery_platform_profile_id']);
        $branchId = $this->destinationOrFail($actor, $input['branch_id'] ?? null);
        $storeId = $this->storeIdOrFail($input['external_store_id'] ?? null);
        [$secret, $prefix] = $this->generateSecret();

        try {
            // نقطة حفظ: انتهاك الفريد في PostgreSQL يُجهض المعاملة كلها إن لم يُرجع
            // إلى نقطة الحفظ. اختبارات RefreshDatabase وطلبات لاحقة تعتمد على ذلك.
            $account = DB::transaction(function () use ($profile, $storeId, $branchId, $actor, $secret, $prefix) {
                $account = new DeliveryConnectorAccount();
                $account->forceFill([
                    'delivery_platform_profile_id' => $profile->id,
                    'platform_key' => $profile->platform_key,
                    'external_store_id' => $storeId,
                    'branch_id' => $branchId,
                    'configured_by' => $actor->id,
                    'secret' => $secret,
                    'secret_prefix' => $prefix,
                    'secret_version' => 1,
                    'status' => DeliveryConnectorAccount::STATUS_CONFIGURED,
                ])->save();

                return $account;
            });
        } catch (UniqueConstraintViolationException) {
            throw new DeliveryConnectorException(
                'mapping_ambiguous',
                'متجر المزوّد مربوط مسبقاً ولا يُعاد تعيينه.',
                409,
            );
        }

        return [$account, $secret];
    }

    /** @return array{0: DeliveryConnectorAccount, 1: string} */
    public function rotateSecret(DeliveryConnectorAccount $account): array
    {
        $this->assertTenant();

        return DB::transaction(function () use ($account) {
            $locked = DeliveryConnectorAccount::query()->whereKey($account->id)->lockForUpdate()->first();
            if ($locked === null || (string) $locked->tenant_id !== (string) app(TenantContext::class)->id()) {
                throw new DeliveryConnectorException('connector_unavailable', 'الربط غير متاح.', 404);
            }

            [$secret, $prefix] = $this->generateSecret();
            $locked->forceFill([
                'secret' => $secret,
                'secret_prefix' => $prefix,
                'secret_version' => ((int) $locked->secret_version) + 1,
            ])->save();

            return [$locked, $secret];
        });
    }

    public function disable(DeliveryConnectorAccount $account): DeliveryConnectorAccount
    {
        $this->assertTenant();
        $account->forceFill([
            'status' => DeliveryConnectorAccount::STATUS_DISABLED,
            'disabled_at' => now(),
        ])->save();

        return $account;
    }

    private function profileOrFail(string $profileId): DeliveryPlatformProfile
    {
        $profile = DeliveryPlatformProfile::query()->whereKey($profileId)->first();
        if ($profile === null || ! $profile->is_active) {
            throw new DeliveryConnectorException('profile_unavailable', 'ملف المنصة غير متاح لهذا المستأجر.', 404);
        }

        return $profile;
    }

    private function destinationOrFail(User $actor, mixed $branchId): ?string
    {
        if (! is_string($branchId) || trim($branchId) === '') {
            if ($actor->allowedBranchIds() !== null) {
                throw new DeliveryConnectorException('branch_required', 'المستخدم المقيّد لا ينشئ ربطاً بلا فرع.', 422);
            }

            return null;
        }

        $branch = Branch::query()->whereKey($branchId)->first();
        if ($branch === null || ! $actor->canAccessBranch((string) $branch->id)) {
            throw new DeliveryConnectorException('branch_unavailable', 'فرع الوجهة غير متاح.', 404);
        }
        if (! $branch->is_active) {
            throw new DeliveryConnectorException('branch_inactive', 'فرع الوجهة غير نشط.', 422);
        }

        return (string) $branch->id;
    }

    private function storeIdOrFail(mixed $value): string
    {
        if (! is_string($value)) {
            throw new DeliveryConnectorException('invalid_store', 'معرّف متجر المزوّد مطلوب.', 422);
        }
        $storeId = trim($value);
        if ($storeId === '' || strlen($storeId) > 191) {
            throw new DeliveryConnectorException('invalid_store', 'معرّف متجر المزوّد مطلوب.', 422);
        }

        return $storeId;
    }

    /** @return array{0: string, 1: string} */
    private function generateSecret(): array
    {
        $secret = self::SECRET_PREFIX . bin2hex(random_bytes(32));

        return [$secret, Str::substr($secret, 0, 14)];
    }

    private function assertTenant(): void
    {
        if (! app(TenantContext::class)->has()) {
            throw new DeliveryConnectorException('tenant_required', 'سياق المستأجر مطلوب.', 403);
        }
    }
}

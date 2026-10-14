<?php

namespace App\Services\DeliveryHub;

use App\Models\Branch;
use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryConnectorLifecycleEvent;
use App\Models\DeliveryConnectorOperatorEvent;
use App\Models\DeliveryPlatformProfile;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * إعداد ربط الموصّل. السر يُولَّد على الخادم ويُعاد مرة واحدة، ويُخزَّن
 * مشفَّراً. لا يُفعّل مزوّداً ولا ينشئ فاتورة.
 *
 * INT-AUDIT-1: الإنشاء والتدوير والتعطيل تكتب حدثاً إلحاقياً (`DeliveryConnectorLifecycleEvent`)
 * **داخل معاملة العملية نفسها** وقبل تعديل الحساب: فشل الكتابة يُلغي العملية كلها، وفشل العملية
 * لا يترك حدثاً. الحدث بلا سر ولا بادئة ولا بيانات طلب.
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
        $this->assertActor($actor);
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

                $this->recordEvent($account, $actor, DeliveryConnectorLifecycleEvent::CREATED, null, 1);

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
    public function rotateSecret(DeliveryConnectorAccount $account, User $actor): array
    {
        $this->assertTenant();
        $this->assertActor($actor);

        return DB::transaction(function () use ($account, $actor) {
            $locked = DeliveryConnectorAccount::query()->whereKey($account->id)->lockForUpdate()->first();
            if ($locked === null || (string) $locked->tenant_id !== (string) app(TenantContext::class)->id()) {
                throw new DeliveryConnectorException('connector_unavailable', 'الربط غير متاح.', 404);
            }

            [$secret, $prefix] = $this->generateSecret();
            $from = (int) $locked->secret_version;
            // الحدث قبل تعديل الحساب: إن فشل لم يُلمس السر أصلاً (ولا يظهر السر الجديد في أي رسالة خطأ).
            $this->recordEvent($locked, $actor, DeliveryConnectorLifecycleEvent::SECRET_ROTATED, $from, $from + 1);
            $locked->forceFill([
                'secret' => $secret,
                'secret_prefix' => $prefix,
                'secret_version' => $from + 1,
            ])->save();

            return [$locked, $secret];
        });
    }

    /**
     * تعطيل نهائي (لا إعادة تفعيل). **idempotent**: تعطيل حساب معطَّل يعيده كما هو بلا تحديث
     * `disabled_at` الأصلي وبلا حدث تدقيق جديد (200 كما كان). الحدث يُكتب عند الانتقال الفعلي فقط.
     */
    public function disable(DeliveryConnectorAccount $account, User $actor): DeliveryConnectorAccount
    {
        $this->assertTenant();
        $this->assertActor($actor);

        return DB::transaction(function () use ($account, $actor) {
            $locked = DeliveryConnectorAccount::query()->whereKey($account->id)->lockForUpdate()->first();
            if ($locked === null || (string) $locked->tenant_id !== (string) app(TenantContext::class)->id()) {
                throw new DeliveryConnectorException('connector_unavailable', 'الربط غير متاح.', 404);
            }
            if ($locked->status === DeliveryConnectorAccount::STATUS_DISABLED) {
                return $locked;
            }

            $version = (int) $locked->secret_version;
            $this->recordEvent($locked, $actor, DeliveryConnectorLifecycleEvent::DISABLED, $version, $version);
            $locked->forceFill([
                'status' => DeliveryConnectorAccount::STATUS_DISABLED,
                'disabled_at' => now(),
            ])->save();

            return $locked;
        });
    }

    /**
     * يعيّن المشغّل الحالي دون المساس بالمنشئ أو بالسر أو بحالة الربط.
     * قفل صف الربط أولاً، ثم إعادة قراءة المستخدمين بلا FOR UPDATE،
     * حتى يبقى ترتيب الأقفال هو صف الربط قبل أي صف آخر (كما في الإدخال).
     */
    public function reassign(DeliveryConnectorAccount $account, User $actor, string $userId): DeliveryConnectorAccount
    {
        $this->assertTenant();

        return DB::transaction(function () use ($account, $actor, $userId) {
            $locked = DeliveryConnectorAccount::query()->whereKey($account->id)->lockForUpdate()->first();
            if ($locked === null || (string) $locked->tenant_id !== (string) app(TenantContext::class)->id()) {
                throw new DeliveryConnectorException('connector_unavailable', 'الربط غير متاح.', 404);
            }

            $admin = User::query()
                ->where('tenant_id', $locked->tenant_id)
                ->whereKey($actor->id)
                ->first();
            if ($admin === null || ! $locked->visibleTo($admin)) {
                throw new DeliveryConnectorException('connector_unavailable', 'الربط غير متاح.', 404);
            }
            if (! $admin->is_active) {
                throw new DeliveryConnectorException('operator_ineligible', 'المستخدم التشغيلي غير مؤهل.', 422);
            }

            $target = $this->eligibleOperator($locked, $userId);
            if ((string) $locked->operated_by === (string) $target->id) {
                return $locked;
            }

            $previous = $locked->operated_by ?? $locked->configured_by;
            if ($previous === null) {
                throw new DeliveryConnectorException('operator_ineligible', 'المستخدم التشغيلي غير مؤهل.', 422);
            }

            $locked->forceFill([
                'operated_by' => $target->id,
            ])->save();

            $event = new DeliveryConnectorOperatorEvent();
            $event->forceFill([
                'tenant_id' => $locked->tenant_id,
                'delivery_connector_account_id' => $locked->id,
                'from_user_id' => $previous,
                'to_user_id' => $target->id,
                'actor_user_id' => $admin->id,
            ])->save();

            return $locked;
        });
    }

    private function eligibleOperator(DeliveryConnectorAccount $account, string $userId): User
    {
        $user = User::query()
            ->where('tenant_id', $account->tenant_id)
            ->whereKey($userId)
            ->first();
        if ($user === null || ! $user->is_active || ! $this->successorCanOperate($account, $user)) {
            throw new DeliveryConnectorException('operator_ineligible', 'المستخدم التشغيلي غير مؤهل.', 422);
        }

        return $user;
    }

    private function successorCanOperate(DeliveryConnectorAccount $account, User $user): bool
    {
        if ($account->branch_id === null) {
            return $user->allowedBranchIds() === null;
        }

        $branch = Branch::query()->whereKey($account->branch_id)->first();
        if ($branch === null || ! $branch->is_active || ! $user->canAccessBranch((string) $branch->id)) {
            return false;
        }

        return true;
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

    /**
     * حدث تدقيق إلحاقي داخل معاملة المستدعي. معرّفات وأرقام إصدار فقط؛ لا سر ولا بادئة ولا طلب.
     * الفرع هو فرع توجيه الحساب وقت العملية (للتصفية لاحقاً)، وليس فرع الفاعل.
     */
    private function recordEvent(DeliveryConnectorAccount $account, User $actor, string $code, ?int $from, ?int $to): void
    {
        (new DeliveryConnectorLifecycleEvent())->forceFill([
            'delivery_connector_account_id' => $account->id,
            'platform_key' => $account->platform_key,
            'external_store_id' => $account->external_store_id,
            'event_code' => $code,
            'actor_user_id' => $actor->id,
            'branch_id' => $account->branch_id,
            'secret_version_from' => $from,
            'secret_version_to' => $to,
        ])->save();
    }

    /** الفاعل من المستأجر الحالي دائماً: سجل التدقيق لا يقبل معرّف فاعل من مستأجر آخر. */
    private function assertActor(User $actor): void
    {
        if ((string) $actor->tenant_id !== (string) app(TenantContext::class)->id()) {
            throw new DeliveryConnectorException('tenant_required', 'سياق المستأجر مطلوب.', 403);
        }
    }

    private function assertTenant(): void
    {
        if (! app(TenantContext::class)->has()) {
            throw new DeliveryConnectorException('tenant_required', 'سياق المستأجر مطلوب.', 403);
        }
    }
}

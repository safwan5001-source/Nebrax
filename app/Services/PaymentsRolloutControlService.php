<?php

namespace App\Services;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\PaymentsRolloutControl;
use App\Models\PaymentsRolloutControlEvent;
use App\Support\PaymentsRolloutChange;
use App\Support\PaymentsRolloutControlException;
use App\Support\PaymentsRolloutState;
use App\Support\SchedulerHeartbeat;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ضوابط تفعيل المدفوعات الإلكترونية — PAY-H1-02 (ميزة `online_payments`)
 * ═══════════════════════════════════════════════════════════════
 *  نمط ضوابط تفعيل ZATCA نفسه (دون مسّها):
 *      مفعَّلة  ⇔  ضابط المستأجر `enabled`  **و**  ليس للمنصة إيقاف طارئ (صفّ منصة `enabled = false`).
 *  غياب صف المستأجر = **معطَّل** (الافتراضي بعد أي نشر). غياب صف المنصة = لا إيقاف مسجَّل.
 *
 *  هذا الضابط **لا يمنح صلاحية ولا يتجاوز عزلاً**: هو شرط لازم لا كافٍ. كل مسار مدفوعات لاحق يبقى خلف `SetTenant`
 *  وRBAC وعزل الفروع كما هو؛ والتفعيل لا يضيف دوراً ولا يوسّع نطاق قراءة. لا يقرؤه أي مسار بعد (القارئ الأول: PAY-H1-03).
 *
 *  القراءة: `effectiveForTenant()` / `effectiveForCurrentTenant()` — عبارة SQL واحدة بلا أقفال، فيرى المستدعي لقطة متسقة.
 *
 *  الكتابة: لمدير منصة نشط فقط عبر `/api/platform/payments-rollout*` (EnsurePlatformAdministrator:platform:manage). تغيير الحالة =
 *  إدراج حدث تدقيق في المعاملة نفسها؛ مُشغّل القاعدة يطبّق الحالة ذرّياً (مقارنة-وتبديل بالنسخة). طلب حالة قائمة أصلاً لا يكتب شيئاً.
 *
 *  ═══ بوابة D-25 (ADR-0004 §5) ═══
 *  **تفعيل** مستأجر يُرفض (`scheduler_unproven`) ما لم تكن نبضة `scheduler` طازجة (≤ ضعف الفاصل). الإيقاف ورفع إيقاف المنصة لا يُبوَّبان:
 *  الإيقاف إجراء أمان، ورفع إيقاف المنصة لا يفعّل مستأجراً لم يُفعَّل أصلاً.
 *
 *  ═══ استراتيجية القفل (للتغييرات) ═══
 *    ضابط مستأجر :  صفّ مدير المنصة (FOR SHARE) ← مِرساة المستأجر `tenants` (FOR UPDATE) ← صفّ الضابط (FOR UPDATE) ← إدراج الحدث
 *    ضابط منصة   :  صفّ مدير المنصة (FOR SHARE) ← صفّ ضابط المنصة (FOR UPDATE) ← إدراج الحدث
 *  مِرساة المستأجر قبل الضابط هو ترتيب كل كاتب لهذا المستأجر؛ لا مسار يأخذ الضابط ثم المِرساة. القارئ لاحقاً يقرأ بلا قفل وبعد المِرساة.
 */
final class PaymentsRolloutControlService
{
    public const MIN_REASON_LENGTH = 3;

    public const MAX_REASON_LENGTH = 500;

    public function __construct(private readonly TenantContext $tenantContext) {}

    // ───────────────────────── القراءة ─────────────────────────

    /** الحالة الفعّالة لمستأجر بعينه (لعرض مدير المنصة ولاختبارات العزل). الميزة غير المعروفة أو المعرّف غير الصالح ⇒ استثناء. */
    public function effectiveForTenant(string $tenantId, string $feature = PaymentsRolloutControl::FEATURE_ONLINE_PAYMENTS): PaymentsRolloutState
    {
        $this->assertFeature($feature);
        $this->assertTenantId($tenantId);

        $rows = PaymentsRolloutControl::query()
            ->where('feature_key', $feature)
            ->where(function ($query) use ($tenantId) {
                $query->where('scope', PaymentsRolloutControl::SCOPE_PLATFORM)
                    ->orWhere(fn ($q) => $q->where('scope', PaymentsRolloutControl::SCOPE_TENANT)->where('tenant_id', $tenantId));
            })
            ->get();

        $platform = $rows->firstWhere('scope', PaymentsRolloutControl::SCOPE_PLATFORM);
        $tenant = $rows->first(fn (PaymentsRolloutControl $row) => $row->scope === PaymentsRolloutControl::SCOPE_TENANT && $row->tenant_id === $tenantId);

        $platformStopped = $platform !== null && ! $platform->enabled;
        $tenantEnabled = $tenant !== null && $tenant->enabled;

        return new PaymentsRolloutState(
            $tenantEnabled && ! $platformStopped,
            match (true) {
                $platformStopped => 'platform_stop',
                $tenant === null => 'tenant_not_configured',
                ! $tenantEnabled => 'tenant_disabled',
                default => 'enabled',
            },
            $tenantEnabled,
            $platformStopped,
        );
    }

    /** الحالة الفعّالة للمستأجر الحالي في السياق (مدخل القراء لاحقاً). بلا سياق مستأجر ⇒ معطَّل (فشل مغلق، لا استثناء). */
    public function effectiveForCurrentTenant(string $feature = PaymentsRolloutControl::FEATURE_ONLINE_PAYMENTS): PaymentsRolloutState
    {
        $this->assertFeature($feature);
        $tenantId = $this->tenantContext->id();
        if (! is_string($tenantId) || ! Str::isUuid($tenantId)) {
            return PaymentsRolloutState::disabled('no_tenant_context');
        }

        return $this->effectiveForTenant($tenantId, $feature);
    }

    // ───────────────────────── الكتابة (مدير منصة نشط فقط) ─────────────────────────

    public function setTenantState(
        PlatformAdministrator $actor,
        string $tenantId,
        bool $enabled,
        string $reason,
        string $feature = PaymentsRolloutControl::FEATURE_ONLINE_PAYMENTS,
    ): PaymentsRolloutChange {
        $this->assertFeature($feature);
        $this->assertTenantId($tenantId);
        $reason = $this->normalizeReason($reason);

        return DB::transaction(function () use ($actor, $tenantId, $enabled, $reason, $feature): PaymentsRolloutChange {
            $this->assertAuthorizedActor($actor);

            if ($enabled && ! SchedulerHeartbeat::isFresh()) {
                throw new PaymentsRolloutControlException('scheduler_unproven');
            }

            // مِرساة المستأجر قبل الضابط (انظر ترتيب الأقفال أعلاه). مستأجر محذوف ناعماً أو غير موجود ⇒ مرفوض.
            $tenant = Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
            if ($tenant === null) {
                throw new PaymentsRolloutControlException('tenant_not_found');
            }

            return $this->applyChange($actor, PaymentsRolloutControl::SCOPE_TENANT, $tenantId, $feature, $enabled, $reason);
        });
    }

    /** `$enabled = false` ⇒ إيقاف طارئ عام يُلغي كل تفعيل مستأجر؛ `true` ⇒ رفعه. */
    public function setPlatformState(
        PlatformAdministrator $actor,
        bool $enabled,
        string $reason,
        string $feature = PaymentsRolloutControl::FEATURE_ONLINE_PAYMENTS,
    ): PaymentsRolloutChange {
        $this->assertFeature($feature);
        $reason = $this->normalizeReason($reason);

        return DB::transaction(function () use ($actor, $enabled, $reason, $feature): PaymentsRolloutChange {
            $this->assertAuthorizedActor($actor);

            return $this->applyChange($actor, PaymentsRolloutControl::SCOPE_PLATFORM, null, $feature, $enabled, $reason);
        });
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function applyChange(
        PlatformAdministrator $actor,
        string $scope,
        ?string $tenantId,
        string $feature,
        bool $enabled,
        string $reason,
    ): PaymentsRolloutChange {
        // الحالة الأساسية عند غياب الصف: مستأجر معطَّل، منصة بلا إيقاف.
        $baseline = $scope === PaymentsRolloutControl::SCOPE_PLATFORM;

        $control = $this->lockedControl($scope, $tenantId, $feature);
        if ($control === null) {
            if ($enabled === $baseline) {
                return new PaymentsRolloutChange(false, $baseline, $baseline, null);
            }

            // ON CONFLICT DO NOTHING: تسابق إنشاءين لا يُجهض المعاملة؛ الخاسر يقرأ صف الفائز بقفل.
            DB::table('payments_rollout_controls')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'scope' => $scope,
                'tenant_id' => $tenantId,
                'feature_key' => $feature,
                'enabled' => $baseline,
                'version' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $control = $this->lockedControl($scope, $tenantId, $feature);
            if ($control === null) {
                throw new PaymentsRolloutControlException('control_unavailable');
            }
        }

        $previous = (bool) $control->enabled;
        if ($previous === $enabled) {
            return new PaymentsRolloutChange(false, $previous, $previous, null);
        }

        // إدراج الحدث هو التغيير: مُشغّل القاعدة يطبّق الحالة بمقارنة-وتبديل على النسخة والحالة السابقة.
        $event = new PaymentsRolloutControlEvent([
            'control_id' => $control->id,
            'scope' => $scope,
            'tenant_id' => $tenantId,
            'feature_key' => $feature,
            'version' => (int) $control->version + 1,
            'previous_enabled' => $previous,
            'new_enabled' => $enabled,
            'platform_administrator_id' => $actor->id,
            'reason' => $reason,
            'occurred_at' => now('UTC'),
        ]);
        $event->save();

        return new PaymentsRolloutChange(true, $previous, $enabled, $event->id);
    }

    private function lockedControl(string $scope, ?string $tenantId, string $feature): ?PaymentsRolloutControl
    {
        $query = PaymentsRolloutControl::query()->where('scope', $scope)->where('feature_key', $feature);
        $scope === PaymentsRolloutControl::SCOPE_TENANT ? $query->where('tenant_id', $tenantId) : $query->whereNull('tenant_id');

        return $query->lockForUpdate()->first();
    }

    /** مدير منصة نشط وغير محذوف، يُعاد تحميله من القاعدة داخل المعاملة (لا يُوثق بنموذج قديم)، ويُقفل مشتركاً حتى نهايتها. */
    private function assertAuthorizedActor(PlatformAdministrator $actor): void
    {
        $fresh = $actor->getKey() === null
            ? null
            : PlatformAdministrator::query()->whereKey($actor->getKey())->where('is_active', true)->sharedLock()->first();

        if ($fresh === null) {
            throw new PaymentsRolloutControlException('unauthorized_actor');
        }
    }

    private function assertFeature(string $feature): void
    {
        if (! in_array($feature, PaymentsRolloutControl::FEATURES, true)) {
            throw new PaymentsRolloutControlException('invalid_feature');
        }
    }

    private function assertTenantId(string $tenantId): void
    {
        if (! Str::isUuid($tenantId)) {
            throw new PaymentsRolloutControlException('invalid_tenant');
        }
    }

    private function normalizeReason(string $reason): string
    {
        $reason = trim($reason);
        $length = mb_strlen($reason);
        if ($length < self::MIN_REASON_LENGTH || $length > self::MAX_REASON_LENGTH) {
            throw new PaymentsRolloutControlException('invalid_reason');
        }

        return $reason;
    }
}

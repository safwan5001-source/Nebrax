<?php

namespace App\Services\Accounting;

use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\ZatcaRolloutControl;
use App\Models\ZatcaRolloutControlEvent;
use App\Support\ZatcaRolloutChange;
use App\Support\ZatcaRolloutControlException;
use App\Support\ZatcaRolloutState;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ضوابط تفعيل ZATCA — REM-18b-3a (أساس فقط: لا يقرؤها أي مسار ترحيل بعد)
 * ═══════════════════════════════════════════════════════════════
 *  الحالة الفعّالة لميزة (اليوم `credit_note_issuance` فقط) لمستأجر:
 *      مفعَّلة  ⇔  ضابط المستأجر `enabled`  **و**  ليس للمنصة إيقاف طارئ (صفّ منصة `enabled = false`).
 *  غياب صف المستأجر = **معطَّل** (الافتراضي بعد أي نشر). غياب صف المنصة = لا إيقاف مسجَّل.
 *
 *  القراءة: `effectiveForTenant()` / `effectiveForCurrentTenant()` — عبارة SQL واحدة تجلب صفّي المستأجر والمنصة معاً، فيرى
 *  المستدعي لقطة واحدة متسقة ولا يرى نصفَي تغييرين. بلا أقفال: القراءة لا تحجب ولا تُحجب.
 *
 *  الكتابة: لمدير منصة نشط فقط (`setTenantState()` / `setPlatformState()`) — لا واجهة للمستأجر ولا مسار HTTP في هذه الشريحة.
 *  تغيير الحالة = إدراج حدث تدقيق في المعاملة نفسها؛ مُشغّل القاعدة يطبّق الحالة على الضابط ذرّياً (مقارنة-وتبديل بالنسخة)،
 *  فلا تغيير بلا حدث ولا حدث بلا تغيير. طلب حالة قائمة أصلاً لا يكتب شيئاً (لا صف ولا حدث).
 *
 *  ═══ استراتيجية القفل (للتغييرات؛ تتوافق مع نموذج مِرساة المستأجر) ═══
 *    ضابط مستأجر :  صفّ مدير المنصة (FOR SHARE) ← مِرساة المستأجر `tenants` (FOR UPDATE) ← صفّ الضابط (FOR UPDATE) ← إدراج الحدث
 *    ضابط منصة   :  صفّ مدير المنصة (FOR SHARE) ← صفّ ضابط المنصة (FOR UPDATE) ← إدراج الحدث
 *  أخذ مِرساة المستأجر **قبل** الضابط هو الترتيب نفسه لكل كاتب لهذا المستأجر (LedgerService/AccountingDateGuard تقفل المِرساة قبل أي قراءة)،
 *  فيتسلسل التغيير مع ترحيلات المستأجر نفسه ولا يرى ترحيلٌ قيمتين، ولا دورة أقفال محتملة: لا مسار يأخذ الضابط ثم المِرساة.
 *  إنشاء الصف الأول يتم بـ`INSERT … ON CONFLICT DO NOTHING` ثم قراءة بقفل، فلا يفسد سباق إنشاء معاملةً (لا خطأ تفرّد يُجهض PostgreSQL).
 *  تغييرات الضابط نفسه تتسلسل بقفل صفّه؛ وتسابق نسختين يمنعه فريد (control_id, version) ومقارنة-وتبديل المُشغّل.
 *
 *  ═══ ما سيلتزم به REM-18b-3c (القارئ داخل ترحيل الإشعار) ═══
 *    مستند ← فاتورة مصدر ← مِرساة المستأجر (LedgerService) ← … ← رأس سلسلة ICV/PIH (مخصِّص السلسلة) ← **قراءة** الضابط (بلا قفل).
 *  الضابط آخر ما يُقرأ، وقراءته واحدة لكل معاملة، وبلا أي قفل عليه من الترحيل. إيقاف المنصة الطارئ يسري على كل معاملة تقرأ بعد
 *  تثبيته؛ معاملة قرأت «مفعَّل» قبله تُكمل (لقطة READ COMMITTED لعبارة واحدة) — وهذا هو السلوك المقصود لا نافذة خطر.
 */
final class ZatcaRolloutControlService
{
    public const MIN_REASON_LENGTH = 3;

    public const MAX_REASON_LENGTH = 500;

    public function __construct(private readonly TenantContext $tenantContext) {}

    // ───────────────────────── القراءة ─────────────────────────

    /** الحالة الفعّالة لمستأجر بعينه (لعرض مدير المنصة ولاختبارات العزل). الميزة غير المعروفة أو المعرّف غير الصالح ⇒ استثناء. */
    public function effectiveForTenant(string $tenantId, string $feature = ZatcaRolloutControl::FEATURE_CREDIT_NOTE_ISSUANCE): ZatcaRolloutState
    {
        $this->assertFeature($feature);
        $this->assertTenantId($tenantId);

        $rows = ZatcaRolloutControl::query()
            ->where('feature_key', $feature)
            ->where(function ($query) use ($tenantId) {
                $query->where('scope', ZatcaRolloutControl::SCOPE_PLATFORM)
                    ->orWhere(fn ($q) => $q->where('scope', ZatcaRolloutControl::SCOPE_TENANT)->where('tenant_id', $tenantId));
            })
            ->get();

        $platform = $rows->firstWhere('scope', ZatcaRolloutControl::SCOPE_PLATFORM);
        $tenant = $rows->first(fn (ZatcaRolloutControl $row) => $row->scope === ZatcaRolloutControl::SCOPE_TENANT && $row->tenant_id === $tenantId);

        $platformStopped = $platform !== null && ! $platform->enabled;
        $tenantEnabled = $tenant !== null && $tenant->enabled;

        return new ZatcaRolloutState(
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

    /** الحالة الفعّالة للمستأجر الحالي في السياق (مدخل REM-18b-3c). بلا سياق مستأجر ⇒ معطَّل (فشل مغلق، لا استثناء). */
    public function effectiveForCurrentTenant(string $feature = ZatcaRolloutControl::FEATURE_CREDIT_NOTE_ISSUANCE): ZatcaRolloutState
    {
        $this->assertFeature($feature);
        $tenantId = $this->tenantContext->id();
        if (! is_string($tenantId) || ! Str::isUuid($tenantId)) {
            return ZatcaRolloutState::disabled('no_tenant_context');
        }

        return $this->effectiveForTenant($tenantId, $feature);
    }

    // ───────────────────────── الكتابة (مدير منصة نشط فقط) ─────────────────────────

    public function setTenantState(
        PlatformAdministrator $actor,
        string $tenantId,
        bool $enabled,
        string $reason,
        string $feature = ZatcaRolloutControl::FEATURE_CREDIT_NOTE_ISSUANCE,
    ): ZatcaRolloutChange {
        $this->assertFeature($feature);
        $this->assertTenantId($tenantId);
        $reason = $this->normalizeReason($reason);

        return DB::transaction(function () use ($actor, $tenantId, $enabled, $reason, $feature): ZatcaRolloutChange {
            $this->assertAuthorizedActor($actor);

            // مِرساة المستأجر قبل الضابط (انظر ترتيب الأقفال أعلاه). مستأجر محذوف ناعماً أو غير موجود ⇒ مرفوض.
            $tenant = Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
            if ($tenant === null) {
                throw new ZatcaRolloutControlException('tenant_not_found');
            }

            return $this->applyChange($actor, ZatcaRolloutControl::SCOPE_TENANT, $tenantId, $feature, $enabled, $reason);
        });
    }

    /** `$enabled = false` ⇒ إيقاف طارئ عام يُلغي كل تفعيل مستأجر؛ `true` ⇒ رفعه. */
    public function setPlatformState(
        PlatformAdministrator $actor,
        bool $enabled,
        string $reason,
        string $feature = ZatcaRolloutControl::FEATURE_CREDIT_NOTE_ISSUANCE,
    ): ZatcaRolloutChange {
        $this->assertFeature($feature);
        $reason = $this->normalizeReason($reason);

        return DB::transaction(function () use ($actor, $enabled, $reason, $feature): ZatcaRolloutChange {
            $this->assertAuthorizedActor($actor);

            return $this->applyChange($actor, ZatcaRolloutControl::SCOPE_PLATFORM, null, $feature, $enabled, $reason);
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
    ): ZatcaRolloutChange {
        // الحالة الأساسية عند غياب الصف: مستأجر معطَّل، منصة بلا إيقاف.
        $baseline = $scope === ZatcaRolloutControl::SCOPE_PLATFORM;

        $control = $this->lockedControl($scope, $tenantId, $feature);
        if ($control === null) {
            if ($enabled === $baseline) {
                return new ZatcaRolloutChange(false, $baseline, $baseline, null);
            }

            // ON CONFLICT DO NOTHING: تسابق إنشاءين لا يُجهض المعاملة؛ الخاسر يقرأ صف الفائز بقفل.
            DB::table('zatca_rollout_controls')->insertOrIgnore([
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
                throw new ZatcaRolloutControlException('control_unavailable');
            }
        }

        $previous = (bool) $control->enabled;
        if ($previous === $enabled) {
            return new ZatcaRolloutChange(false, $previous, $previous, null);
        }

        // إدراج الحدث هو التغيير: مُشغّل القاعدة يطبّق الحالة بمقارنة-وتبديل على النسخة والحالة السابقة.
        $event = new ZatcaRolloutControlEvent([
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

        return new ZatcaRolloutChange(true, $previous, $enabled, $event->id);
    }

    private function lockedControl(string $scope, ?string $tenantId, string $feature): ?ZatcaRolloutControl
    {
        $query = ZatcaRolloutControl::query()->where('scope', $scope)->where('feature_key', $feature);
        $scope === ZatcaRolloutControl::SCOPE_TENANT ? $query->where('tenant_id', $tenantId) : $query->whereNull('tenant_id');

        return $query->lockForUpdate()->first();
    }

    /** مدير منصة نشط وغير محذوف، يُعاد تحميله من القاعدة داخل المعاملة (لا يُوثق بنموذج قديم)، ويُقفل مشتركاً حتى نهايتها. */
    private function assertAuthorizedActor(PlatformAdministrator $actor): void
    {
        $fresh = $actor->getKey() === null
            ? null
            : PlatformAdministrator::query()->whereKey($actor->getKey())->where('is_active', true)->sharedLock()->first();

        if ($fresh === null) {
            throw new ZatcaRolloutControlException('unauthorized_actor');
        }
    }

    private function assertFeature(string $feature): void
    {
        if (! in_array($feature, ZatcaRolloutControl::FEATURES, true)) {
            throw new ZatcaRolloutControlException('invalid_feature');
        }
    }

    private function assertTenantId(string $tenantId): void
    {
        if (! Str::isUuid($tenantId)) {
            throw new ZatcaRolloutControlException('invalid_tenant');
        }
    }

    private function normalizeReason(string $reason): string
    {
        $reason = trim($reason);
        $length = mb_strlen($reason);
        if ($length < self::MIN_REASON_LENGTH || $length > self::MAX_REASON_LENGTH) {
            throw new ZatcaRolloutControlException('invalid_reason');
        }

        return $reason;
    }
}

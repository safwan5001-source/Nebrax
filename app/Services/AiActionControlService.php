<?php

namespace App\Services;

use App\Models\AiActionControl;
use App\Models\AiActionControlEvent;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Support\AiActionControlChange;
use App\Support\AiActionControlException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ضوابط المشغّل لإجراءات المساعد — IMP-X-01a (الكتابة)
 * ═══════════════════════════════════════════════════════════════
 *  الكتابة لمدير منصة نشط فقط (`EnsurePlatformAdministrator:platform:manage` في مسارات `/api/platform`)، بسببٍ إلزامي، وتغيير الحالة =
 *  إدراج حدث تدقيق في المعاينة نفسها؛ مُشغّل القاعدة يطبّق الحالة ذرّياً بمقارنة-وتبديل على النسخة. طلب حالة قائمة أصلاً لا يكتب شيئاً.
 *
 *  **الافتراضي رفض (D-11):** غياب الصف = معطَّل؛ التفعيل «منحة» صريحة. الضوابط هنا شرط لازم لا كافٍ: لا تمنح صلاحية ولا توسّع فرعاً ولا تتجاوز
 *  المعاينة والموافقة، وأعلام البيئة أرضية صلبة لا تتجاوزها (D-10) — يقرؤها `AiActionsAccessResolver` لا هذه الخدمة.
 *
 *  ═══ استراتيجية القفل (كنمط المدفوعات) ═══
 *    ضابط مستأجر :  صفّ مدير المنصة (FOR SHARE) ← مِرساة المستأجر `tenants` (FOR UPDATE) ← صفّ الضابط (FOR UPDATE) ← إدراج الحدث
 *    ضابط منصة   :  صفّ مدير المنصة (FOR SHARE) ← صفّ ضابط المنصة (FOR UPDATE) ← إدراج الحدث
 */
final class AiActionControlService
{
    public const MIN_REASON_LENGTH = 3;

    public const MAX_REASON_LENGTH = 500;

    public function __construct(private readonly AiActionRegistry $registry) {}

    /** منحة/سحب لنوعٍ بعينه (أو `*` = المفتاح الرئيسي) على مستوى المنصة. */
    public function setPlatformState(PlatformAdministrator $actor, string $actionType, string $capability, bool $enabled, string $reason): AiActionControlChange
    {
        $this->assertType($actionType, allowAll: true);
        $this->assertCapability($capability);
        $reason = $this->normalizeReason($reason);

        return DB::transaction(function () use ($actor, $actionType, $capability, $enabled, $reason): AiActionControlChange {
            $this->assertAuthorizedActor($actor);

            return $this->applyChange($actor, AiActionControl::SCOPE_PLATFORM, null, $actionType, $capability, $enabled, $reason);
        });
    }

    /** منحة/سحب لمستأجر ونوعٍ بعينه (لا `*`). */
    public function setTenantState(PlatformAdministrator $actor, string $tenantId, string $actionType, string $capability, bool $enabled, string $reason): AiActionControlChange
    {
        $this->assertType($actionType, allowAll: false);
        $this->assertCapability($capability);
        if (! Str::isUuid($tenantId)) {
            throw new AiActionControlException('invalid_tenant');
        }
        $reason = $this->normalizeReason($reason);

        return DB::transaction(function () use ($actor, $tenantId, $actionType, $capability, $enabled, $reason): AiActionControlChange {
            $this->assertAuthorizedActor($actor);

            // مِرساة المستأجر قبل الضابط (ترتيب كل كاتب لهذا المستأجر). مستأجر محذوف ناعماً أو غير موجود ⇒ مرفوض.
            if (Tenant::query()->whereKey($tenantId)->lockForUpdate()->first() === null) {
                throw new AiActionControlException('tenant_not_found');
            }

            return $this->applyChange($actor, AiActionControl::SCOPE_TENANT, $tenantId, $actionType, $capability, $enabled, $reason);
        });
    }

    private function applyChange(PlatformAdministrator $actor, string $scope, ?string $tenantId, string $actionType, string $capability, bool $enabled, string $reason): AiActionControlChange
    {
        $control = $this->lockedControl($scope, $tenantId, $actionType, $capability);
        if ($control === null) {
            // الحالة الأساسية عند غياب الصف: معطَّل. طلب «معطَّل» لا يكتب شيئاً.
            if (! $enabled) {
                return new AiActionControlChange(false, false, false, null);
            }

            // ON CONFLICT DO NOTHING: تسابق إنشاءين لا يُجهض المعاملة؛ الخاسر يقرأ صف الفائز بقفل.
            DB::table('ai_action_controls')->insertOrIgnore([
                'id' => (string) Str::uuid(),
                'scope' => $scope,
                'tenant_id' => $tenantId,
                'action_type' => $actionType,
                'capability' => $capability,
                'enabled' => false,
                'version' => 0,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $control = $this->lockedControl($scope, $tenantId, $actionType, $capability);
            if ($control === null) {
                throw new AiActionControlException('control_unavailable');
            }
        }

        $previous = (bool) $control->enabled;
        if ($previous === $enabled) {
            return new AiActionControlChange(false, $previous, $previous, null);
        }

        // إدراج الحدث هو التغيير: مُشغّل القاعدة يطبّق الحالة بمقارنة-وتبديل على النسخة والحالة السابقة.
        $event = new AiActionControlEvent([
            'control_id' => $control->id,
            'scope' => $scope,
            'tenant_id' => $tenantId,
            'action_type' => $actionType,
            'capability' => $capability,
            'version' => (int) $control->version + 1,
            'previous_enabled' => $previous,
            'new_enabled' => $enabled,
            'platform_administrator_id' => $actor->id,
            'reason' => $reason,
            'occurred_at' => now('UTC'),
        ]);
        $event->save();

        return new AiActionControlChange(true, $previous, $enabled, $event->id);
    }

    private function lockedControl(string $scope, ?string $tenantId, string $actionType, string $capability): ?AiActionControl
    {
        $query = AiActionControl::query()->where('scope', $scope)->where('action_type', $actionType)->where('capability', $capability);
        $scope === AiActionControl::SCOPE_TENANT ? $query->where('tenant_id', $tenantId) : $query->whereNull('tenant_id');

        return $query->lockForUpdate()->first();
    }

    /** مدير منصة نشط وغير محذوف، يُعاد تحميله من القاعدة داخل المعاملة (لا يُوثق بنموذج قديم)، ويُقفل مشتركاً حتى نهايتها. */
    private function assertAuthorizedActor(PlatformAdministrator $actor): void
    {
        $fresh = $actor->getKey() === null
            ? null
            : PlatformAdministrator::query()->whereKey($actor->getKey())->where('is_active', true)->sharedLock()->first();

        if ($fresh === null) {
            throw new AiActionControlException('unauthorized_actor');
        }
    }

    private function assertType(string $actionType, bool $allowAll): void
    {
        if ($allowAll && $actionType === AiActionControl::ALL_TYPES) {
            return;
        }
        if (! in_array($actionType, $this->registry->types(), true)) {
            throw new AiActionControlException('invalid_action_type');
        }
    }

    private function assertCapability(string $capability): void
    {
        if (! in_array($capability, AiActionControl::CAPABILITIES, true)) {
            throw new AiActionControlException('invalid_capability');
        }
    }

    private function normalizeReason(string $reason): string
    {
        $reason = trim($reason);
        $length = mb_strlen($reason);
        if ($length < self::MIN_REASON_LENGTH || $length > self::MAX_REASON_LENGTH) {
            throw new AiActionControlException('invalid_reason');
        }

        return $reason;
    }
}

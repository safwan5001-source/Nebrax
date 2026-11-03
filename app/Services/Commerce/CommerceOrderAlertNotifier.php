<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\User;
use App\Services\NotificationService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * منتِج إشعار «طلب متجر جديد» للتاجر (COPS-H3-1، ADR-30 §0 R-8) عبر `NotificationService::deliver()` حصراً (لا جدول ثانٍ).
 *
 * **متى:** الطلب `confirmed` غير ملغى ودفعه **جاهز** (R-5): نية COD/استلام (`awaiting_collection`/`collected`) أو إلكترونية `paid` — الإلكتروني غير المدفوع لا يُنبَّه به.
 * **لمن (R-8):** كل مستخدم **نشط** في مستأجر الطلب يملك `commerce.orders.view` فعلياً (الدور المخزَّن أو `*`)، **ومعزول** بنطاق المخازن (المقيَّد لا يُنبَّه إلا بطلب
 * مخزنه الفعّال — `CommerceOrderWarehouseScope`)، وتفضيله الشخصي `preferences.commerce_alerts.enabled` ليس `false` (H3-7). الأدوار لا تُمنح شيئاً بهذا: الإشعار
 * مؤشّر، وفتح الطلب يعيد تفويضه من الخادم.
 * **dedupe:** مفتاح واحد لكل (مستلم، طلب) ⇒ طلب COD يُنبَّه به مرة، والإلكتروني مرة عند الدفع مهما تكرر الحدث/المصالحة.
 * **الحمولة:** رقم الطلب فقط (لا اسم عميل ولا هاتف ولا عنوان ولا مبلغ). بوابة النشر مغلقة افتراضياً. لا قيد ولا مخزون ولا قفل جديد (قراءة + إدراج إشعار).
 */
final class CommerceOrderAlertNotifier
{
    public const TYPE = 'commerce.order_placed';

    public const ACTION = 'view_commerce_order';

    public const SOURCE_TYPE = 'commerce_order';

    public const PERMISSION = 'commerce.orders.view';

    public function __construct(
        private readonly NotificationService $notifications,
        private readonly TenantContext $tenant,
    ) {}

    public static function enabled(): bool
    {
        return (bool) config('commerce.order_alerts_enabled');
    }

    /**
     * @return int عدد المستلمين الذين سُلِّم لهم (أو وُجد لهم إشعار الطلب مسبقاً)
     */
    public function notify(string $tenantId, string $orderId): int
    {
        if (! self::enabled()) {
            return 0;
        }

        $owned = ! $this->tenant->has();
        if ($owned) {
            $this->tenant->set($tenantId);
        } elseif ((string) $this->tenant->id() !== $tenantId) {
            return 0; // سياق مستأجر مختلف: لا نخلطه
        }

        try {
            $order = CommerceOrder::query()
                ->with('paymentIntent:id,commerce_order_id,status')
                ->find($orderId);
            if ($order === null || $order->tenant_id !== $tenantId || ! $this->alertable($order)) {
                return 0;
            }

            $delivered = 0;
            $roleAllows = [];
            $users = User::query()->where('tenant_id', $tenantId)->where('is_active', true)->get();
            foreach ($users as $user) {
                try {
                    $roleAllows[$user->role] ??= $user->hasPermission(self::PERMISSION);
                    if (! $roleAllows[$user->role] || ! $this->wantsAlerts($user) || ! $this->canSee($order, $user)) {
                        continue;
                    }
                    $this->notifications->deliver([
                        'tenant_id' => $tenantId,
                        'recipient_id' => $user->id,
                        'category' => 'alert',
                        'type' => self::TYPE,
                        'severity' => 'info',
                        'title' => 'طلب جديد من المتجر',
                        'message' => 'وصل طلب جديد رقم '.$order->number.'.',
                        'source_type' => self::SOURCE_TYPE,
                        'source_id' => $order->id,
                        'action' => self::ACTION,
                        'data' => ['order_number' => $order->number],
                        'dedupe_key' => 'commerce.order_alert:'.$order->id,
                    ]);
                    $delivered++;
                } catch (Throwable $e) {
                    // مستلم واحد لا يمنع الباقين، ولا يُفشل الإتمام (معرّفات فقط في السجل).
                    Log::warning('commerce.order_alert.recipient_failed', ['tenant_id' => $tenantId, 'order_id' => $orderId, 'user_id' => $user->id, 'exception' => $e::class]);
                }
            }

            return $delivered;
        } finally {
            if ($owned) {
                $this->tenant->forget();
            }
        }
    }

    /** R-5: مؤكَّد غير ملغى ودفع جاهز. */
    private function alertable(CommerceOrder $order): bool
    {
        return $order->status === CommerceOrder::STATUS_CONFIRMED
            && $order->cancelled_at === null
            && $order->paymentIntent !== null
            && in_array($order->paymentIntent->status, CommerceOrderAttentionQuery::PAYMENT_READY, true);
    }

    /** تفضيل المستخدم (H3-7): الغياب = مفعّل؛ `false` وحده يوقف. */
    private function wantsAlerts(User $user): bool
    {
        $preferences = is_array($user->preferences) ? $user->preferences : [];

        return ($preferences['commerce_alerts']['enabled'] ?? true) !== false;
    }

    /** نطاق المخازن (D-H2-11): غير المقيَّد يرى الكل؛ المقيَّد بمخزن الطلب الفعّال فقط (فشل مغلق إن لم يُحدَّد). */
    private function canSee(CommerceOrder $order, User $user): bool
    {
        $allowed = $user->allowedWarehouseIds();
        if ($allowed === null) {
            return true;
        }

        return CommerceOrderWarehouseScope::apply(CommerceOrder::query()->whereKey($order->id), $allowed)->exists();
    }
}

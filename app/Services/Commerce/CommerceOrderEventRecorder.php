<?php

namespace App\Services\Commerce;

use App\Events\CommerceOrderCancelled;
use App\Events\CommerceOrderDomainEvent;
use App\Events\CommerceOrderPaymentCollected;
use App\Events\CommerceOrderPaymentPaid;
use App\Events\CommerceOrderPlaced;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use InvalidArgumentException;
use LogicException;
use Throwable;

/**
 * الكاتب الوحيد لسجل أحداث طلب المتجر وتسلسل التغذية (COPS-H1-1، ADR-29 §2.4).
 *
 * ═══ العقد ═══
 *  • يُستدعى **داخل** معاملة الانتقال نفسها (يرفض العمل خارج معاملة): فشل الكتابة يُرجع الانتقال كله، والتراجع يُرجع الحدث والعدّاد معاً.
 *  • يُستدعى **آخر عبارة كتابة** في المعاملة المالكة الخارجية. يقفل صف `commerce_order_feed_heads` للمستأجر `FOR UPDATE` (صف قفل ثابت لا
 *    يُحدَّث) ثم يُدرج الحدث بعبارة واحدة تحسب `max(feed_seq) + 1` من الفهرس الفريد (مُشغّل القاعدة يرفض غير ذلك). القفل يبقى حتى الالتزام، وكل
 *    عبارة في READ COMMITTED تأخذ لقطة جديدة بعد نيله ⇒ ترى حدث الممسك السابق ملتزماً؛ فـ`feed_seq` يُخصَّص بترتيب الالتزام لكل مستأجر بلا
 *    فجوات، ومستطلِع رأى `seq = N` ملتزماً يضمن أن كل ما دونه إما ملتزم ومرئي أو غير مُخصَّص بعد.
 *  • الرأس قفلٌ لا عدّاد: تحديث صف ساخن في كل حدث جعل المنتظرين يتبعون سلسلة إصداراته فطال ذيل الانتظار (قياس R-2 في تقرير H1-1).
 *  • **لا يلمس صف `tenants`**: لا قفل ولا مفتاح أجنبي إليه (فحص FK الحدث يقع على صف الرأس المقفول أصلاً) — فلا حلقة مع مِرساة الترقيم/الأستاذ.
 *  • لا شبكة ولا مزوّد ولا قيد ولا مخزون. `data` قائمة بيضاء لكل نوع (`CommerceOrderEvent::DATA_KEYS`) بقيم نصية قصيرة فقط.
 *
 * Idempotency حالة-مبنية: يكتب المستدعي الحدث على فرع الانتقال الفعلي وحده (إعادة الإتمام/الإلغاء/الالتقاط/التحصيل لا تصل إليه).
 *
 * ═══ أحداث النطاق بعد الالتزام (COPS-H1-2) ═══
 *  بعد الإدراج يسجّل `DB::afterCommit` إطلاقَ حدث Laravel المقابل (`CommerceOrderPlaced`…): لا يُطلق إن تراجعت المعاملة (أو معاملتها الخارجية)،
 *  ويُطلق مرة واحدة لكل انتقال فعلي (الإعادات لا تصل إلى `append`). لا عبارة قاعدة بيانات إضافية داخل المعاملة (زمن إمساك قفل الرأس لم يتغيّر).
 *  الإطلاق **محميّ**: أي استثناء من مستمع يُسجَّل بالمعرّفات فقط ولا يُعاد رميه — لا يُفشل الطلب ولا الاستجابة ولا الانتقال الملتزم؛ التغذية والمصالحة
 *  هما شبكة الأمان للفقد.
 */
final class CommerceOrderEventRecorder
{
    private const HEADS = 'commerce_order_feed_heads';

    private const EVENTS = 'commerce_order_events';

    private const UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

    /** @var array<string, class-string<CommerceOrderDomainEvent>> */
    private const DOMAIN_EVENTS = [
        CommerceOrderEvent::ORDER_PLACED => CommerceOrderPlaced::class,
        CommerceOrderEvent::ORDER_CANCELLED => CommerceOrderCancelled::class,
        CommerceOrderEvent::PAYMENT_PAID => CommerceOrderPaymentPaid::class,
        CommerceOrderEvent::PAYMENT_COLLECTED => CommerceOrderPaymentCollected::class,
    ];

    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * @param  array<string, string>  $data
     */
    public function append(CommerceOrder $order, string $type, string $actorType, ?string $actorId = null, array $data = []): void
    {
        if (DB::transactionLevel() === 0) {
            throw new LogicException('أحداث الطلب تُكتب داخل معاملة الانتقال نفسها فقط.');
        }
        if (! in_array($type, CommerceOrderEvent::TYPES, true)) {
            throw new InvalidArgumentException('نوع حدث طلب غير معتمد.');
        }
        if (! in_array($actorType, CommerceOrderEvent::ACTORS, true)) {
            throw new InvalidArgumentException('نوع فاعل حدث الطلب غير معتمد.');
        }
        $needsActor = in_array($actorType, [CommerceOrderEvent::ACTOR_USER, CommerceOrderEvent::ACTOR_CUSTOMER], true);
        if ($needsActor !== ($actorId !== null && $actorId !== '')) {
            throw new InvalidArgumentException('فاعل حدث الطلب غير متسق مع نوعه.');
        }
        $allowed = CommerceOrderEvent::DATA_KEYS[$type];
        foreach ($data as $key => $value) {
            if (! in_array($key, $allowed, true) || ! is_string($value) || strlen($value) > 64) {
                throw new InvalidArgumentException('بيانات حدث الطلب خارج القائمة البيضاء.');
            }
        }

        $tenantId = (string) $order->tenant_id;
        if (preg_match(self::UUID, $tenantId) !== 1 || ($this->tenant->has() && (string) $this->tenant->id() !== $tenantId)) {
            throw new LogicException('حدث الطلب يُكتب في سياق مستأجر الطلب نفسه فقط.');
        }

        $this->lockHead($tenantId);

        // بعد نيل القفل، عبارة واحدة: لقطتها الجديدة تُظهر آخر حدث ملتزم، و`max + 1` يُحسب ويُدرَج معاً (جولة واحدة أثناء إمساك القفل؛
        // الفهرس الفريد `(tenant_id, feed_seq)` يجعل `max` قراءة فهرس واحدة). المعرّف مُتحقَّق منه بصيغة UUID قبل إدراجه حرفياً في الاستعلام الفرعي.
        $now = now('UTC');
        $eventId = (string) Str::uuid();
        DB::table(self::EVENTS)->insert([
            'id' => $eventId,
            'tenant_id' => $tenantId,
            'commerce_order_id' => (string) $order->getKey(),
            'feed_seq' => DB::raw('(SELECT COALESCE(MAX(e.feed_seq), 0) + 1 FROM '.self::EVENTS." e WHERE e.tenant_id = '{$tenantId}')"),
            'type' => $type,
            'actor_type' => $actorType,
            'actor_id' => $needsActor ? $actorId : null,
            'data' => $data === [] ? null : json_encode($data, JSON_UNESCAPED_UNICODE),
            'occurred_at' => $now,
            'created_at' => $now,
        ]);

        $orderId = (string) $order->getKey();
        DB::afterCommit(fn () => $this->publish($type, $tenantId, $orderId, $eventId));
    }

    /**
     * يُطلق حدث النطاق بعد الالتزام. محميّ: استثناء المستمع لا يتجاوز هذه الدالة (الانتقال ملتزم أصلاً؛ الفشل يُسجَّل بالمعرّفات فقط، بلا PII).
     */
    private function publish(string $type, string $tenantId, string $orderId, string $eventId): void
    {
        $class = self::DOMAIN_EVENTS[$type] ?? null;
        if ($class === null) {
            return;
        }
        try {
            event(new $class($tenantId, $orderId, $eventId));
        } catch (Throwable $e) {
            Log::warning('commerce.order_event.listener_failed', [
                'type' => $type, 'tenant_id' => $tenantId, 'order_id' => $orderId, 'event_id' => $eventId, 'exception' => $e::class,
            ]);
        }
    }

    /**
     * الرأس يُنشأ مع المستأجر (مُشغّل القاعدة) فيوجد دائماً في المسار المعتاد. غيابه حالة شاذة (مستأجر سبق الهجرة بلا زرع، أو SQLite أعاد بناء
     * `tenants` فأسقط المُشغّل): يُدرَج `ON CONFLICT DO NOTHING` ثم يُقفل — إدراجه وحده يمسّ FK المستأجر، ولا يحدث إلا مرة لكل مستأجر.
     */
    private function lockHead(string $tenantId): void
    {
        if (DB::table(self::HEADS)->where('tenant_id', $tenantId)->lockForUpdate()->value('tenant_id') !== null) {
            return;
        }

        DB::table(self::HEADS)->insertOrIgnore(['tenant_id' => $tenantId, 'created_at' => now('UTC')]);

        if (DB::table(self::HEADS)->where('tenant_id', $tenantId)->lockForUpdate()->value('tenant_id') === null) {
            throw new LogicException('تعذّر تهيئة رأس تغذية أحداث الطلب.');
        }
    }
}

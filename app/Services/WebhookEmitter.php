<?php

namespace App\Services;

use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Models\WebhookEvent;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * مُصدِر أحداث الـ Webhooks (الصندوق الصادر الدائم) — يُستدعى من مُلاحِظ إنشاء
 * المجال (Partner/Product/Invoice) فيعمل على **مستوى المجال**: أيّ واجهة أنشأت
 * الكيان (Public API أو داخليّ) تُنتج الحدث نفسه.
 *
 * دلالة الالتزام: يُنشئ الحدث + صفوف التسليم داخل معاملة (savepoint متداخل إن
 * كان الإنشاء ضمن معاملة)، فحدثٌ لمستأجرٍ له اشتراكٌ مفعَّل يلتزم مع عملية الأعمال.
 *
 * **عزل الفشل (§30):** لا يكسر أيّ خطأٍ هنا عملية الأعمال الملتزمة — الإصدار
 * مغلَّف بـ try/catch يبلّغ ولا يرمي. الـ savepoint يعزل كتابة الـ Webhook وحدها.
 *
 * لا يُنشئ حدثًا بلا مشترِك: يُادَّى الحدث فقط عند وجود اشتراكٍ **مفعَّل** يطابق
 * نوعه — فلا صفوف يتيمة، ولا أثر على مسارات لا مشتركين لها.
 *
 * مستقلّ عن سياق المستأجر المحيط: يقرأ بـ `withoutGlobalScopes` ويصفّي بـ
 * `tenant_id` صراحةً، ويكتب `tenant_id` صراحةً — فيصحّ في الطلب وفي CLI سواء.
 */
class WebhookEmitter
{
    public const API_VERSION = 'v1';

    /**
     * يُصدر حدثًا لكيانٍ أُنشئ للتوّ. `$payloadBuilder` يبني كتلة `data` المُنتقاة
     * (مورد Public) كسولًا — لا تُبنى إن لم يوجد مشترِك.
     *
     * @param  callable():array<string,mixed>  $payloadBuilder
     */
    public function emit(Model $model, string $eventType, callable $payloadBuilder): void
    {
        $tenantId = $model->getAttribute('tenant_id');
        if (! is_string($tenantId) || $tenantId === '') {
            return; // بلا مستأجر لا يمكن التوجيه.
        }

        try {
            // مسارٌ سريعٌ بلا معاملة حين لا مشترِك (الغالب): استعلامُ اشتراكٍ واحد
            // مفهرس، فلا أثر على مسارات لا webhooks لها.
            $endpoints = WebhookEndpoint::query()
                ->withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('status', WebhookEndpoint::STATUS_ENABLED)
                ->get()
                ->filter(static fn (WebhookEndpoint $e): bool => in_array($eventType, (array) $e->event_types, true));

            if ($endpoints->isEmpty()) {
                return; // لا مشترِك → لا حدث.
            }

            $sourceType = $model->getMorphClass();
            $sourceId = (string) $model->getKey();

            // فحص إزالة التكرار + الكتابة داخل معاملة واحدة = savepoint متداخل إن كان
            // الإنشاء ضمن معاملة. حاسمٌ لعزل الفشل على PostgreSQL: أيّ خطأٍ هنا يُرجِع
            // الـ savepoint فيبقى تعامل الأعمال الخارجيّ سليمًا (لا «معاملة مُجهَضة»)،
            // فلا يكسر إصدارُ الـ Webhook إنشاءَ الأعمال الملتزم.
            DB::transaction(function () use ($tenantId, $eventType, $sourceType, $sourceId, $payloadBuilder, $endpoints): void {
                // إزالة تكرار حتميّة: حدثٌ واحد لكل (مصدر، نوع) — أمانٌ ضدّ إصدارٍ مزدوج.
                $exists = WebhookEvent::query()
                    ->withoutGlobalScopes()
                    ->where('source_type', $sourceType)
                    ->where('source_id', $sourceId)
                    ->where('type', $eventType)
                    ->exists();

                if ($exists) {
                    return;
                }

                $event = WebhookEvent::query()->create([
                    'tenant_id'   => $tenantId,
                    'type'        => $eventType,
                    'api_version' => self::API_VERSION,
                    'source_type' => $sourceType,
                    'source_id'   => $sourceId,
                    'payload'     => $payloadBuilder(),
                    'occurred_at' => now(),
                ]);

                $now = now();
                foreach ($endpoints as $endpoint) {
                    WebhookDelivery::query()->create([
                        'tenant_id'           => $tenantId,
                        'webhook_event_id'    => $event->id,
                        'webhook_endpoint_id' => $endpoint->id,
                        'status'              => WebhookDelivery::STATUS_PENDING,
                        'attempts'            => 0,
                        'next_attempt_at'     => $now, // المحاولة الأولى فوريّة.
                    ]);
                }
            });
        } catch (Throwable $e) {
            // عزل الفشل: لا يكسر إصدار الـ Webhook عملية الأعمال — بلّغ فقط.
            report($e);
        }
    }
}

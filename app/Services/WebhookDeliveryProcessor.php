<?php

namespace App\Services;

use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Support\WebhookSignature;
use App\Support\WebhookUrlException;
use App\Support\WebhookUrlValidator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * مُعالج تسليم الـ Webhooks (PR-7) — يعمل على البنية القائمة فعلاً (لا عامل خلفي؛
 * الإنتاج `QUEUE_CONNECTION=sync`)، فيُستدعى عبر أمر Artisan (`webhooks:deliver`).
 *
 * التزامن الآمن (§21): **مطالبة ذرّية بإيجار** — تحديثٌ محروسٌ يقلب الصفّ إلى
 * `processing` بإيجار زمنيّ، فمُشغّلان متزامنان لا يسلّمان الصفّ نفسه. المطالبة
 * تلتزم أولًا، ثم يجري HTTP **خارج أي معاملة**، ثم يُسجَّل الناتج. الصفّ العالق في
 * `processing` بإيجارٍ منقضٍ (مُشغّل مات) يُستعاد.
 *
 * أمان النقل (§18): مهلة اتصال وإجماليّة صارمة، بلا إعادة توجيه، تحقّق TLS مُفعَّل،
 * مقتطف استجابة محدود، User-Agent آمن. إعادة تحقّق SSRF **قبل كلّ إرسال** (يضيّق
 * نافذة إعادة ربط DNS). النجاح = 2xx؛ ما عداه فشلٌ يُعاد بتراجعٍ حتميّ محدود.
 */
class WebhookDeliveryProcessor
{
    public function __construct(private readonly WebhookUrlValidator $validator)
    {
    }

    /**
     * يطالب دفعةً من المستحقّات ويسلّمها. يعيد ملخّص أعداد.
     *
     * @return array{claimed:int, delivered:int, retried:int, failed:int}
     */
    public function processDueBatch(?int $limit = null): array
    {
        $limit = $limit ?? (int) config('webhooks.delivery.batch_size', 50);
        $summary = ['claimed' => 0, 'delivered' => 0, 'retried' => 0, 'failed' => 0];

        foreach ($this->claimBatch($limit) as $delivery) {
            $summary['claimed']++;
            $summary[$this->deliver($delivery)]++;
        }

        return $summary;
    }

    /**
     * مطالبة ذرّية: يقلب كلّ صفٍّ مستحقٍّ (أو عالقٍ بإيجارٍ منقضٍ) إلى `processing`
     * بإيجارٍ جديد عبر تحديثٍ محروسٍ يفوز به مُشغّلٌ واحد. حتميّ على SQLite وPostgreSQL.
     *
     * @return list<WebhookDelivery>
     */
    private function claimBatch(int $limit): array
    {
        $now = now();
        $leaseUntil = $now->copy()->addSeconds((int) config('webhooks.delivery.lease_seconds', 120));

        $candidateIds = WebhookDelivery::query()
            ->withoutGlobalScopes()
            ->where(fn ($q) => $this->claimableCondition($q, $now))
            ->orderBy('next_attempt_at')
            ->limit($limit)
            ->pluck('id');

        $claimed = [];
        foreach ($candidateIds as $id) {
            $affected = WebhookDelivery::query()
                ->withoutGlobalScopes()
                ->where('id', $id)
                ->where(fn ($q) => $this->claimableCondition($q, $now))
                ->update([
                    'status'         => WebhookDelivery::STATUS_PROCESSING,
                    'reserved_until' => $leaseUntil,
                    'updated_at'     => $now,
                ]);

            if ($affected === 1) {
                $delivery = WebhookDelivery::query()->withoutGlobalScopes()->find($id);
                if ($delivery !== null) {
                    $claimed[] = $delivery;
                }
            }
        }

        return $claimed;
    }

    /** شرط الأهليّة: مستحقٌّ (pending/retry_scheduled ومستحقّ) أو عالقٌ (إيجار منقضٍ). */
    private function claimableCondition($query, Carbon $now): void
    {
        $query->where(function ($q) use ($now) {
            $q->whereIn('status', [WebhookDelivery::STATUS_PENDING, WebhookDelivery::STATUS_RETRY_SCHEDULED])
                ->where('next_attempt_at', '<=', $now);
        })->orWhere(function ($q) use ($now) {
            $q->where('status', WebhookDelivery::STATUS_PROCESSING)
                ->where('reserved_until', '<=', $now);
        });
    }

    /**
     * يسلّم صفًّا مُطالَبًا: يبني المغلَّف والجسم الخام، يوقّع، يرسل بأمان، ويسجّل
     * الناتج (delivered/retried/failed). يعيد صنف الناتج للملخّص.
     */
    public function deliver(WebhookDelivery $delivery): string
    {
        $endpoint = WebhookEndpoint::query()->withoutGlobalScopes()->find($delivery->webhook_endpoint_id);

        // اختفى الاشتراك أو عُطِّل بعد المطالبة → لا تسليم (المعطَّل لا يستقبل شيئًا).
        if ($endpoint === null || ! $endpoint->isEnabled()) {
            return $this->markFailed($delivery, null, 'endpoint_disabled', null, 0);
        }

        $event = $delivery->event()->withoutGlobalScopes()->first();
        if ($event === null) {
            return $this->markFailed($delivery, $endpoint, 'event_missing', null, 0);
        }

        $timestamp = now()->timestamp;
        $rawBody = $this->rawBody($event);

        // إعادة تحقّق SSRF قبل الإرسال — عنوانٌ صار محظورًا لا يُسلَّم (نهائيّ، لا يُعاد).
        try {
            $this->validator->validate($endpoint->url);
        } catch (WebhookUrlException $e) {
            return $this->markFailed($delivery, $endpoint, 'blocked_url:' . $e->reason, null, 0);
        }

        $signature = WebhookSignature::sign((string) $endpoint->secret, $timestamp, $rawBody);
        $headers = $this->headers($delivery, $event, $timestamp, $signature);

        $startedAt = microtime(true);
        try {
            $response = Http::withHeaders($headers)
                ->connectTimeout((int) config('webhooks.delivery.connect_timeout', 5))
                ->timeout((int) config('webhooks.delivery.timeout', 10))
                ->withoutRedirecting()
                ->withOptions(['stream' => true])
                ->withBody($rawBody, 'application/json')
                ->post($endpoint->url);
        } catch (Throwable $e) {
            // فشل نقل (اتصال/مهلة) — قابل لإعادة المحاولة.
            $durationMs = (int) round((microtime(true) - $startedAt) * 1000);

            return $this->recordFailure($delivery, $endpoint, null, $this->errorCategory($e), null, $durationMs);
        }

        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);
        $status = $response->status();
        $snippet = $this->boundedBody($response);

        if ($status >= 200 && $status < 300) {
            return $this->markDelivered($delivery, $endpoint, $status, $snippet, $durationMs);
        }

        // 3xx (بلا إعادة توجيه) و4xx/5xx = فشل قابل لإعادة المحاولة حتى النفاد.
        return $this->recordFailure($delivery, $endpoint, $status, 'http_' . $status, $snippet, $durationMs);
    }

    /** الجسم الخام الموقَّع والمُرسَل حرفيًّا — المغلَّف المُصدَّر (id/type/data…). */
    private function rawBody(\App\Models\WebhookEvent $event): string
    {
        $envelope = [
            'id'          => $event->id,
            'type'        => $event->type,
            'api_version' => $event->api_version,
            'created_at'  => optional($event->occurred_at)->toIso8601String(),
            'tenant'      => ['id' => $event->tenant_id],
            'data'        => $event->payload,
        ];

        return (string) json_encode($envelope, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** @return array<string,string> */
    private function headers(WebhookDelivery $delivery, \App\Models\WebhookEvent $event, int $timestamp, string $signature): array
    {
        return [
            'Content-Type'                    => 'application/json',
            'User-Agent'                      => (string) config('webhooks.delivery.user_agent', 'AWJ-Webhooks/1.0'),
            WebhookSignature::HEADER_ID        => $event->id,
            WebhookSignature::HEADER_DELIVERY  => $delivery->id,
            WebhookSignature::HEADER_EVENT     => $event->type,
            WebhookSignature::HEADER_ATTEMPT   => (string) ($delivery->attempts + 1),
            WebhookSignature::HEADER_TIMESTAMP => (string) $timestamp,
            WebhookSignature::HEADER_SIGNATURE => WebhookSignature::signatureHeader($timestamp, $signature),
        ];
    }

    /** يقرأ مقتطفًا محدودًا من جسم الاستجابة (لا يُخزَّن جسم ضخم). */
    private function boundedBody($response): ?string
    {
        $limit = (int) config('webhooks.delivery.response_snippet_bytes', 2048);
        try {
            $body = $response->toPsrResponse()->getBody();
            $chunk = $body->read($limit);
            $chunk = is_string($chunk) ? $chunk : '';
        } catch (Throwable) {
            $chunk = mb_strcut((string) $response->body(), 0, $limit);
        }

        $chunk = trim($chunk);

        return $chunk === '' ? null : mb_strcut($chunk, 0, $limit);
    }

    private function markDelivered(WebhookDelivery $delivery, WebhookEndpoint $endpoint, int $status, ?string $snippet, int $durationMs): string
    {
        $delivery->forceFill([
            'status'                => WebhookDelivery::STATUS_DELIVERED,
            'attempts'              => $delivery->attempts + 1,
            'next_attempt_at'       => null,
            'reserved_until'        => null,
            'last_status_code'      => $status,
            'last_error'            => null,
            'last_duration_ms'      => $durationMs,
            'last_response_snippet' => $snippet,
            'delivered_at'          => now(),
        ])->save();

        $endpoint->forceFill(['last_success_at' => now()])->save();

        return 'delivered';
    }

    /** يقرّر بين إعادة الجدولة والفشل النهائيّ وفق عدّاد المحاولات. */
    private function recordFailure(WebhookDelivery $delivery, WebhookEndpoint $endpoint, ?int $status, string $error, ?string $snippet, int $durationMs): string
    {
        $attempts = $delivery->attempts + 1;
        $maxAttempts = (int) config('webhooks.delivery.max_attempts', 6);

        if ($attempts >= $maxAttempts) {
            return $this->markFailed($delivery, $endpoint, $error, $status, $durationMs, $snippet, $attempts);
        }

        $backoff = (array) config('webhooks.delivery.backoff_seconds', [60, 300, 1800, 7200, 21600]);
        // فهرس التأخير بالمحاولة التي جرت للتوّ (1-based → 0-based).
        $delay = $backoff[$attempts - 1] ?? end($backoff);

        $delivery->forceFill([
            'status'                => WebhookDelivery::STATUS_RETRY_SCHEDULED,
            'attempts'              => $attempts,
            'next_attempt_at'       => now()->addSeconds((int) $delay),
            'reserved_until'        => null,
            'last_status_code'      => $status,
            'last_error'            => $error,
            'last_duration_ms'      => $durationMs,
            'last_response_snippet' => $snippet,
        ])->save();

        $endpoint->forceFill(['last_failure_at' => now()])->save();

        return 'retried';
    }

    /** فشل نهائيّ (نفاد المحاولات، أو خطأ غير قابل لإعادة المحاولة). */
    private function markFailed(WebhookDelivery $delivery, ?WebhookEndpoint $endpoint, string $error, ?int $status, int $durationMs, ?string $snippet = null, ?int $attempts = null): string
    {
        $delivery->forceFill([
            'status'                => WebhookDelivery::STATUS_FAILED,
            'attempts'              => $attempts ?? $delivery->attempts,
            'next_attempt_at'       => null,
            'reserved_until'        => null,
            'last_status_code'      => $status,
            'last_error'            => $error,
            'last_duration_ms'      => $durationMs,
            'last_response_snippet' => $snippet,
            'failed_at'             => now(),
        ])->save();

        if ($endpoint !== null) {
            $endpoint->forceFill(['last_failure_at' => now()])->save();
        }

        return 'failed';
    }

    private function errorCategory(Throwable $e): string
    {
        $class = class_basename($e);

        // تصنيف مختصر بلا تسريب تفاصيل داخليّة/أسرار في السجلّ.
        return match (true) {
            str_contains($class, 'ConnectionException') => 'connection_error',
            str_contains(strtolower($e->getMessage()), 'timeout') => 'timeout',
            default => 'transport_error',
        };
    }
}

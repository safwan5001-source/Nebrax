<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\PreviewExchangeReference;
use App\Models\PreviewSession;
use App\Models\PreviewSessionEvent;
use App\Models\Tenant;
use App\Models\User;
use App\Tenancy\TenantScope;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * دورة حياة مرجع تبادل QR/الرابط العميق لمرّة واحدة (MOBILE-PREVIEW-7) —
 * تطبيقٌ حرفي لِما أجّلته وثيقة معمارية MP-5 §5.10/§5.14 صراحةً لهذه المهمة.
 *
 * **نيّة إنشاء جلسة لا جلسة بذاتها**: `issueForDraft()` ينسخ لقطة المسودة
 * الحالية إلى `PreviewExchangeReference` — لا يُنشئ `PreviewSession` ولا توكن
 * Sanctum بعد. الجلسة الفعلية لا تولد إلا عند أول تبادل ناجح
 * (`consume()`)، فلا بصمة عملٍ خامّة تُصدَر دون أن تُستهلَك تبقى معلّقة على
 * الخادم — العكس تماماً لو أصدرنا `PreviewSession` فوراً وأعدنا توكنها مباشرة:
 * ذلك كان سيضع بصمة عمل حقيقية في يد المتصفح قبل أي تبادل جهازٍ فعلي،
 * بالضبط ما يمنعه العقد الأمني المعتمد (`No long-lived reusable exchange
 * credential`؛ هنا لا يوجد بصمة عملٍ إطلاقاً حتى الاستهلاك).
 *
 * **الاستهلاك ذرّي**: `consume()` يستعمل نفس بنية `AuthRecoveryService::consume()`
 * حرفياً — معاملة + `lockForUpdate()` على صفّ المرجع، فحص الحالة *داخل*
 * المعاملة لا قبلها، فلا يمكن لطلبين متزامنين لنفس المرجع أن يفوزا معاً
 * (§8 من المهمة: "concurrent double-exchange cannot mint two usable
 * sessions").
 */
class PreviewExchangeService
{
    /** يصدر مرجع تبادل عن **المسودة الحالية** فقط — نفس نطاق `PreviewSessionService::issueForDraft()`. */
    public function issueForDraft(BuilderApp $app, ?User $issuer, ?string $deviceLabel = null): array
    {
        $draft = $app->draft()->first();
        if ($draft === null) {
            throw new RuntimeException('لا توجد مسودة لهذا التطبيق.');
        }

        // عشوائية كافية (Str::random(40) ~ 238 بت من محارف base62) — أعلى بكثير
        // من أي حدّ أدنى معياري لرمز تبادل لمرّة واحدة قصير الأجل.
        $plain = Str::random(40);
        $expiresAt = now()->addMinutes(PreviewExchangeReference::TTL_MINUTES);

        $reference = PreviewExchangeReference::create([
            'tenant_id' => $app->tenant_id,
            'builder_app_id' => $app->id,
            'reference_hash' => hash('sha256', $plain),
            'schema_snapshot' => $draft->schema,
            'draft_revision' => $draft->revision,
            'channel' => PreviewSession::CHANNEL_DEVICE,
            'device_label' => $deviceLabel,
            'created_by' => $issuer?->id,
            'expires_at' => $expiresAt,
        ]);

        PreviewSessionEvent::create([
            'tenant_id' => $app->tenant_id,
            'preview_session_id' => null,
            'action' => PreviewSessionEvent::ACTION_EXCHANGE_CREATED,
            'changed_by' => $issuer?->id,
            // معرّف الصفّ نفسه فقط — لا النصّ الخام إطلاقاً (§5.12).
            'reason' => $reference->id,
        ]);

        return ['reference' => $reference, 'plain' => $plain, 'expires_at' => $expiresAt];
    }

    /**
     * يستهلك مرجع تبادل ذرّياً وينشئ جلسة معاينة حقيقية عند أول نجاح فقط.
     * يرجع `null` لأي حالة رفض (مجهول/منتهٍ/مستهلَك/تطبيق أو مستأجر معطَّل) —
     * **نفس الاستجابة العامة** لكل الحالات عند المتحكّم (§5.15، لا تسريب سبب).
     *
     * @return array{session: PreviewSession, token: \Laravel\Sanctum\NewAccessToken}|null
     */
    public function consume(string $plain): ?array
    {
        if ($plain === '' || strlen($plain) > 128) {
            return null;
        }

        return DB::transaction(function () use ($plain) {
            $hash = hash('sha256', $plain);

            // حلّ عالمي متجاوزاً `TenantScope` — لا سياق مستأجر موجود أصلاً عند
            // هذه النقطة (مسار عام قبل أي مصادقة)، تماماً كـ`AuthenticatePreviewSession`.
            $record = PreviewExchangeReference::withoutGlobalScope(TenantScope::class)
                ->where('reference_hash', $hash)
                ->lockForUpdate()
                ->first();

            if ($record === null) {
                return null;
            }

            if ($record->isConsumed()) {
                $this->recordRejected($record, 'consumed');

                return null;
            }

            if ($record->isExpired()) {
                $this->recordRejected($record, 'expired');

                return null;
            }

            $tenant = Tenant::find($record->tenant_id);
            if ($tenant === null || ! $tenant->is_active) {
                $this->recordRejected($record, 'tenant_inactive');

                return null;
            }

            $app = BuilderApp::withoutGlobalScope(TenantScope::class)->find($record->builder_app_id);
            if ($app === null) {
                $this->recordRejected($record, 'app_missing');

                return null;
            }

            $expiresAt = now()->addMinutes(PreviewSession::DEFAULT_TTL_MINUTES);

            $session = PreviewSession::create([
                'tenant_id' => $record->tenant_id,
                'builder_app_id' => $record->builder_app_id,
                'source' => PreviewSession::SOURCE_DRAFT,
                'schema_snapshot' => $record->schema_snapshot,
                'draft_revision' => $record->draft_revision,
                'channel' => PreviewSession::CHANNEL_DEVICE,
                'device_label' => $record->device_label,
                'created_by' => $record->created_by,
                'expires_at' => $expiresAt,
            ]);

            $token = $session->createToken('preview-device', [PreviewSession::ABILITY_READ], $expiresAt);

            // الاستهلاك أولاً: أي محاولة ثانية لنفس المرجع تجد `consumed_at`
            // مضبوطاً بالفعل حتى لو فشل شيء لاحق (لا احتمال إعادة تنشيط).
            $record->forceFill([
                'consumed_at' => now(),
                'preview_session_id' => $session->id,
            ])->save();

            PreviewSessionEvent::create([
                'tenant_id' => $record->tenant_id,
                'preview_session_id' => $session->id,
                'action' => PreviewSessionEvent::ACTION_CREATED,
                'changed_by' => $record->created_by,
            ]);
            PreviewSessionEvent::create([
                'tenant_id' => $record->tenant_id,
                'preview_session_id' => $session->id,
                'action' => PreviewSessionEvent::ACTION_EXCHANGED,
                // معرّف صفّ المرجع نفسه فقط — لا نصّه الخام (§5.12).
                'reason' => $record->id,
            ]);

            return ['session' => $session, 'token' => $token];
        });
    }

    private function recordRejected(PreviewExchangeReference $record, string $reason): void
    {
        PreviewSessionEvent::create([
            'tenant_id' => $record->tenant_id,
            'preview_session_id' => $record->preview_session_id,
            'action' => PreviewSessionEvent::ACTION_REJECTED,
            'reason' => 'exchange_'.$reason,
        ]);
    }
}

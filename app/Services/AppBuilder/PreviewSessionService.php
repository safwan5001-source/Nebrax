<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderApp;
use App\Models\PreviewSession;
use App\Models\PreviewSessionEvent;
use App\Models\User;
use RuntimeException;

/**
 * دورة حياة جلسات معاينة App Builder — تطبيقٌ حرفي لـMOBILE-PREVIEW-5
 * (`docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §5.1-§5.7).
 *
 * **نطاق MP-6**: يصدر عن **المسودة الحالية فقط** (`source = draft`) — هذا
 * حرفياً ما طلبته المهمة ("create a runtime preview session for an
 * unpublished Draft"). المصدران الآخران المُوثَّقان في المعمارية
 * (`published`/`default`) مؤجَّلان صراحةً لمهمة لاحقة؛ العمود/الثابت
 * موجودان في النموذج (§5.3 من المعمارية) فلا كسر عقدٍ لاحقاً، لكن لا مسار
 * إصدارٍ فعلي لهما اليوم.
 *
 * **TTL ثابت لا معامل طلب**: 15 دقيقة دائماً (الافتراضي المعتمد في §5.6) —
 * لا تمديد ولا تقصير قابل للطلب في MP-6؛ توسعة ذلك قرارٌ منتجي منفصل.
 */
class PreviewSessionService
{
    /** يصدر جلسة معاينة للمسودة الحالية لتطبيق. يرمي عند غياب مسودة (لا يُفترَض أن يحدث). */
    public function issueForDraft(
        BuilderApp $app,
        ?User $issuer,
        string $channel = PreviewSession::CHANNEL_DEVICE,
        ?string $deviceLabel = null,
    ): array {
        if (! in_array($channel, PreviewSession::CHANNELS, true)) {
            throw new RuntimeException('قناة معاينة غير معروفة.');
        }

        $draft = $app->draft()->first();
        if ($draft === null) {
            throw new RuntimeException('لا توجد مسودة لهذا التطبيق.');
        }

        $expiresAt = now()->addMinutes(PreviewSession::DEFAULT_TTL_MINUTES);

        $session = PreviewSession::create([
            'tenant_id' => $app->tenant_id,
            'builder_app_id' => $app->id,
            'source' => PreviewSession::SOURCE_DRAFT,
            'schema_snapshot' => $draft->schema,
            'draft_revision' => $draft->revision,
            'channel' => $channel,
            'device_label' => $deviceLabel,
            'created_by' => $issuer?->id,
            'expires_at' => $expiresAt,
        ]);

        $token = $session->createToken('preview', [PreviewSession::ABILITY_READ], $expiresAt);

        PreviewSessionEvent::create([
            'tenant_id' => $app->tenant_id,
            'preview_session_id' => $session->id,
            'action' => PreviewSessionEvent::ACTION_CREATED,
            'changed_by' => $issuer?->id,
        ]);

        return ['session' => $session, 'token' => $token];
    }

    /** يُبطل جلسة فوراً: يحذف توكناتها ويختم `revoked_at`. غير قابل للتراجع. */
    public function revoke(PreviewSession $session, ?User $revoker): void
    {
        $session->tokens()->delete();
        $session->forceFill(['revoked_at' => now()])->save();

        PreviewSessionEvent::create([
            'tenant_id' => $session->tenant_id,
            'preview_session_id' => $session->id,
            'action' => PreviewSessionEvent::ACTION_REVOKED,
            'changed_by' => $revoker?->id,
        ]);
    }

    /**
     * لقطة القراءة التي يعيدها `preview/v1/experience` — لا تمسّ `BuilderDraftExperience`
     * إطلاقاً، وتسجّل حدث `opened` مرّة واحدة فقط لكل جلسة (أول جلب ناجح، §5.12).
     *
     * `draft_changed` استشاريٌّ لا حاجزٌ: يقارن مراجعة اللقطة المجمَّدة بمراجعة
     * المسودة الحيّة الآن (قراءة رخيصة، لا قيمة مخزَّنة مكرَّرة) دون أن يمنع
     * العرض أو يستبدل المحتوى أبداً (§5.5).
     *
     * @return array{schema: array, source: string, draft_revision: ?int, draft_changed: bool, expires_at: string}
     */
    public function readExperience(PreviewSession $session): array
    {
        $this->recordOpenedOnce($session);

        $currentRevision = $session->app?->draft()->value('revision');

        return [
            'schema' => $session->schema_snapshot,
            'source' => $session->source,
            'draft_revision' => $session->draft_revision,
            'draft_changed' => $session->draft_revision !== null
                && $currentRevision !== null
                && (int) $currentRevision !== (int) $session->draft_revision,
            'expires_at' => $session->expires_at->toIso8601String(),
        ];
    }

    private function recordOpenedOnce(PreviewSession $session): void
    {
        $alreadyOpened = PreviewSessionEvent::query()
            ->where('preview_session_id', $session->id)
            ->where('action', PreviewSessionEvent::ACTION_OPENED)
            ->exists();

        if ($alreadyOpened) {
            return;
        }

        PreviewSessionEvent::create([
            'tenant_id' => $session->tenant_id,
            'preview_session_id' => $session->id,
            'action' => PreviewSessionEvent::ACTION_OPENED,
        ]);
    }
}

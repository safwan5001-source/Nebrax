<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionExtraction;
use App\Models\AiActionRepair;
use App\Models\User;
use App\Support\AiActionCostVisibility;
use App\Support\AiActionException;
use App\Support\ProductImportFields;
use App\Support\ProductImportValueNormalizer;

/** AI-ACTIONS-03: edits an inert proposal only; it never calls ERP writers. */
final class AiActionProductReviewService
{
    /** Decisions a reviewer may set; `needs_review` is only ever assigned by the server. */
    private const DECISIONS = ['create', 'update', 'skip'];

    public function __construct(private readonly AiActionGateway $gateway) {}

    /** @return array{action:AiAction,proposal:array,manifest_hash:?string} */
    public function show(User $actor, AiAction $action): array
    {
        $action = $this->gateway->show($actor, $action);
        $effective = $this->effective($action);

        return ['action' => $action, 'proposal' => $effective['proposal'], 'manifest_hash' => $effective['manifest_hash']];
    }

    /**
     * The single definition of "the proposal the user is looking at": the latest
     * saved version once it carries rows, else the immutable extraction manifest.
     * AI-ACTIONS-04 previews bind to exactly this.
     *
     * @return array{proposal:array,proposal_hash:?string,manifest_hash:string,file_sha256:?string}
     */
    public function effective(AiAction $action): array
    {
        $latest = $action->relationLoaded('versions') ? $action->versions->first() : $action->versions()->orderByDesc('version')->first();
        $hasRows = $latest !== null && (($latest->proposal['rows'] ?? []) !== []);
        // A repair action (06B) has no source file: its rows were seeded directly into version 1.
        $extraction = $hasRows ? $action->extractions()->orderByDesc('action_version')->first() : $this->extraction($action);
        $proposal = $hasRows ? $latest->proposal : ['schema_version' => 1, 'rows' => $extraction->manifest['rows'] ?? []];

        return [
            'proposal' => $proposal,
            'proposal_hash' => $latest?->proposal_hash,
            'manifest_hash' => $extraction?->manifest_hash,
            'file_sha256' => $extraction?->manifest['source']['content_sha256'] ?? null,
        ];
    }

    public function edit(User $actor, AiAction $action, int $expectedVersion, array $edits): AiAction
    {
        $review = $this->show($actor, $action);
        if ($review['action']->version !== $expectedVersion) {
            throw new AiActionException('version_conflict', 'تغيّرت المسودة. حدّث بيانات المراجعة قبل الحفظ.', 409);
        }
        $proposal = $review['proposal'];
        $rows = $proposal['rows'] ?? [];
        $byId = [];
        foreach ($rows as $index => $row) $byId[(string) $row['row_id']] = $index;
        // AI-ACTIONS-06B: a repair action may only change the fields tied to why its row failed.
        $repair = AiActionRepair::query()->where('ai_action_id', $action->id)->first();
        foreach ($edits as $edit) {
            $rowId = (string) ($edit['row_id'] ?? '');
            $decision = $edit['decision'] ?? null;
            $hasFields = is_array($edit['fields'] ?? null) && $edit['fields'] !== [];
            // AI-ACTIONS-06: the explicit, per-row decision to append images to an EXISTING product's gallery.
            $mediaDecision = array_key_exists('media_update_approved', $edit) ? filter_var($edit['media_update_approved'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) : null;
            if (! isset($byId[$rowId]) || (! $hasFields && $decision === null && $mediaDecision === null) || (isset($edit['fields']) && ! is_array($edit['fields']))
                || ($decision !== null && ! in_array($decision, self::DECISIONS, true))
                || (array_key_exists('media_update_approved', $edit) && $mediaDecision === null)) {
                throw new AiActionException('review_edit_invalid', 'صف أو تعديل مراجعة غير صالح.', 422);
            }
            $index = $byId[$rowId];
            foreach ($hasFields ? $edit['fields'] : [] as $field => $value) {
                if ($repair !== null && ! in_array($field, $repair->rows[$rowId]['affected_fields'] ?? [], true)) {
                    throw new AiActionException('repair_field_locked', 'هذا الحقل لم يتسبب في فشل الصف، فلا يُعدَّل في الإصلاح. عدّل الحقول المرتبطة بالفشل فقط.', 422);
                }
                if ($field === AiActionCostVisibility::FIELD && ! AiActionCostVisibility::allows($actor)) {
                    throw new AiActionException('cost_permission_required', 'إدخال سعر الشراء أو تعديله يتطلب صلاحية عرض التكلفة.', 403);
                }
                if (! is_string($field) || ProductImportFields::get($field) === null || ! $this->valid($field, $value)) {
                    throw new AiActionException('review_field_invalid', 'قيمة حقل المراجعة غير صالحة.', 422);
                }
                $rows[$index]['fields'][$field] = ['value' => $value, 'origin' => $value === null ? 'missing' : 'user', 'confidence' => null];
            }
            if ($hasFields) {
                // Changing an image source voids an earlier "add images" decision: it was about other images.
                if (array_intersect(array_keys($edit['fields']), ['primary_image_url', 'additional_image_urls']) !== []) {
                    $rows[$index]['media'] = $this->media($rows[$index]['fields']);
                }
                $rows[$index]['violations'] = array_values(array_filter($rows[$index]['violations'] ?? [], fn (array $v) => ! in_array($v['field'] ?? null, array_keys($edit['fields']), true)));
            }
            if ($mediaDecision !== null) {
                $media = $rows[$index]['media'] ?? ['primary' => null, 'additional' => [], 'existing_update_approved' => false];
                $media['existing_update_approved'] = $mediaDecision;
                $rows[$index]['media'] = $media;
            }
            // An explicit user decision wins; otherwise a deliberate update/skip survives a field edit.
            $rows[$index]['decision'] = $decision ?? (in_array($rows[$index]['decision'] ?? null, ['update', 'skip'], true)
                ? $rows[$index]['decision']
                : ($this->hasErrors($rows[$index]['violations']) ? 'needs_review' : 'create'));
        }
        $proposal['rows'] = $rows;
        $updated = $this->gateway->addVersion($actor, $action, $expectedVersion, $proposal, costGuard: false);
        AiActionEvent::create([
            'ai_action_id' => $updated->id, 'version' => $updated->version, 'event' => 'product_review_edited',
            'from_status' => AiAction::STATUS_CREATED, 'to_status' => $updated->status, 'actor_id' => $actor->id,
            'metadata' => ['edited_rows' => count($edits)], 'occurred_at' => now('UTC'),
        ]);

        return $updated;
    }

    private function extraction(AiAction $action): AiActionExtraction
    {
        $extraction = $action->extractions()->orderByDesc('action_version')->first();
        if ($extraction === null) throw new AiActionException('extraction_unavailable', 'ارفع ملف المنتجات قبل المراجعة.', 404);
        return $extraction;
    }

    /** IMP-H2-S2: حكمٌ واحد مشترك مع الاستخراج والمعاينة (`ProductImportValueNormalizer`) بدل نسخة regex خاصة بهذه الخطوة. */
    private function valid(string $field, mixed $value): bool
    {
        return ProductImportValueNormalizer::isValid($field, $value);
    }

    private function media(array $fields): ?array
    {
        $primary = $fields['primary_image_url']['value'] ?? null;
        $raw = $fields['additional_image_urls']['value'] ?? null;
        $additional = $raw === null ? [] : array_values(array_filter(array_map('trim', preg_split('/[;|\r\n]+/', (string) $raw) ?: [])));
        if ($primary === null && $additional === []) return null;
        return ['primary' => $primary === null ? null : ['kind' => 'url', 'value' => (string) $primary, 'sha256' => null], 'additional' => array_map(fn ($url) => ['kind' => 'url', 'value' => $url, 'sha256' => null], array_slice($additional, 0, 7)), 'existing_update_approved' => false];
    }

    private function hasErrors(array $violations): bool
    {
        foreach ($violations as $violation) if (($violation['severity'] ?? null) === 'error') return true;
        return false;
    }
}

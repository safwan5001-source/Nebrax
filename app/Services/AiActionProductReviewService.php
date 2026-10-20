<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionExtraction;
use App\Models\User;
use App\Support\AiActionCostVisibility;
use App\Support\AiActionException;
use App\Support\ProductImportFields;

/** AI-ACTIONS-03: edits an inert proposal only; it never calls ERP writers. */
final class AiActionProductReviewService
{
    /** Decisions a reviewer may set; `needs_review` is only ever assigned by the server. */
    private const DECISIONS = ['create', 'update', 'skip'];

    public function __construct(private readonly AiActionGateway $gateway) {}

    /** @return array{action:AiAction,proposal:array,manifest_hash:string} */
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
        $extraction = $this->extraction($action);
        $latest = $action->relationLoaded('versions') ? $action->versions->first() : $action->versions()->orderByDesc('version')->first();
        $proposal = $latest !== null && (($latest->proposal['rows'] ?? []) !== [])
            ? $latest->proposal
            : ['schema_version' => 1, 'rows' => $extraction->manifest['rows'] ?? []];

        return [
            'proposal' => $proposal,
            'proposal_hash' => $latest?->proposal_hash,
            'manifest_hash' => $extraction->manifest_hash,
            'file_sha256' => $extraction->manifest['source']['content_sha256'] ?? null,
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
        foreach ($edits as $edit) {
            $rowId = (string) ($edit['row_id'] ?? '');
            $decision = $edit['decision'] ?? null;
            $hasFields = is_array($edit['fields'] ?? null) && $edit['fields'] !== [];
            if (! isset($byId[$rowId]) || (! $hasFields && $decision === null) || (isset($edit['fields']) && ! is_array($edit['fields']))
                || ($decision !== null && ! in_array($decision, self::DECISIONS, true))) {
                throw new AiActionException('review_edit_invalid', 'صف أو تعديل مراجعة غير صالح.', 422);
            }
            $index = $byId[$rowId];
            foreach ($hasFields ? $edit['fields'] : [] as $field => $value) {
                if ($field === AiActionCostVisibility::FIELD && ! AiActionCostVisibility::allows($actor)) {
                    throw new AiActionException('cost_permission_required', 'إدخال سعر الشراء أو تعديله يتطلب صلاحية عرض التكلفة.', 403);
                }
                if (! is_string($field) || ProductImportFields::get($field) === null || ! $this->valid($field, $value)) {
                    throw new AiActionException('review_field_invalid', 'قيمة حقل المراجعة غير صالحة.', 422);
                }
                $rows[$index]['fields'][$field] = ['value' => $value, 'origin' => $value === null ? 'missing' : 'user', 'confidence' => null];
            }
            if ($hasFields) {
                $rows[$index]['media'] = $this->media($rows[$index]['fields']);
                $rows[$index]['violations'] = array_values(array_filter($rows[$index]['violations'] ?? [], fn (array $v) => ! in_array($v['field'] ?? null, array_keys($edit['fields']), true)));
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

    private function valid(string $field, mixed $value): bool
    {
        if ($value !== null && ! is_string($value) && ! is_int($value) && ! is_float($value) && ! is_bool($value)) return false;
        $definition = ProductImportFields::get($field) ?? [];
        if (is_string($value) && mb_strlen($value) > (int) ($definition['max'] ?? 10000)) return false;
        if ($value === null) return true;
        $normal = strtr(trim((string) $value), ['٠'=>'0','١'=>'1','٢'=>'2','٣'=>'3','٤'=>'4','٥'=>'5','٦'=>'6','٧'=>'7','٨'=>'8','٩'=>'9','٫'=>'.','٬'=>'']);
        return match ($definition['type'] ?? null) {
            ProductImportFields::TYPE_MONEY => preg_match('/^\d+(?:\.\d{1,4})?$/', $normal) === 1,
            ProductImportFields::TYPE_PERCENT => preg_match('/^\d+(?:\.\d+)?%?$/', $normal) === 1 && (float) rtrim($normal, '%') <= 100,
            ProductImportFields::TYPE_INTEGER => preg_match('/^\d+$/', $normal) === 1,
            ProductImportFields::TYPE_ENUM => in_array(strtolower((string) $value), (array) ($definition['values'] ?? []), true),
            default => true,
        };
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

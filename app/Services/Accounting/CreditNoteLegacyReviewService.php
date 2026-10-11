<?php

namespace App\Services\Accounting;

use App\Models\CreditNote;
use App\Models\CreditNoteLegacyReview;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\User;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-02 — مسار مراجعة المالية للإشعارات التاريخية غير المحسومة
 * ═══════════════════════════════════════════════════════════════
 *  الفاتورة التي عليها إشعار دائن مرحَّل قديم لا يُنسب إلى سطر بلا تخمين (بلا منتج، أو
 *  منتجه يتكرر) تُحظر عليها العمليات الإضافية (انظر
 *  `ReturnSourceAllocator::assertNoUnresolvedLegacyCredits`). هنا يُرفع الحظر بقرارٍ
 *  مكتوب لكل سطر — لا بتعديل مستندٍ مرحَّل:
 *
 *    - `attributed`    : يستهلك سطراً بعينه من **الفاتورة نفسها** (فيُحسب في السقف).
 *    - `not_applicable`: لا يستهلك سطراً (تسوية بلا كمية)؛ فلا يُحسب.
 *
 *  لكل قرار سبب إلزامي ومراجِعٌ من المؤسسة نفسها وتاريخ. النطاق مستأجرٌ واحد
 *  (`TenantContext` يجب أن يكون مضبوطاً) فلا يعبر المستأجرين.
 */
class CreditNoteLegacyReviewService
{
    public function __construct(protected ReturnSourceAllocator $allocator) {}

    /**
     * الأسطر غير المحسومة في المستأجر الحالي مع مرشّحات السطر المناسبة من فاتورتها.
     *
     * @return list<array<string, mixed>>
     */
    public function unresolved(): array
    {
        $invoiceIds = CreditNote::query()
            ->where('status', 'posted')->whereNotNull('original_invoice_id')
            ->distinct()->pluck('original_invoice_id')->all();

        $invoices = Invoice::query()->whereIn('id', $invoiceIds)->get(['id', 'number'])->keyBy('id');
        $candidates = InvoiceLine::query()->whereIn('invoice_id', $invoiceIds)->orderBy('id')
            ->get(['id', 'invoice_id', 'description', 'quantity', 'product_id'])->groupBy('invoice_id');

        $rows = [];
        foreach ($this->allocator->legacyCreditLines($invoiceIds) as $item) {
            if ($item['status'] !== 'unresolved') {
                continue;
            }

            /** @var CreditNoteLine $line */
            $line = $item['line'];
            $rows[] = [
                'invoice_id' => $item['invoice_id'],
                'invoice_number' => $invoices->get($item['invoice_id'])?->number,
                'credit_note_number' => $line->creditNote->number,
                'credit_note_line_id' => $line->id,
                'product_id' => $line->product_id,
                'description' => $line->description,
                'quantity' => (int) $line->quantity,
                'net' => (int) $line->line_subtotal - (int) $line->line_discount,
                'tax' => (int) $line->line_tax,
                'candidate_lines' => ($candidates->get($item['invoice_id']) ?? collect())->map(fn ($l) => [
                    'id' => $l->id, 'description' => $l->description, 'quantity' => (int) $l->quantity,
                    'same_product' => $line->product_id !== null && $l->product_id === $line->product_id,
                ])->values()->all(),
            ];
        }

        return $rows;
    }

    /**
     * يسجّل قرار المراجعة لسطرٍ غير محسوم. لا يمسّ أي مستند مرحَّل.
     *
     * @throws RuntimeException عند أي مخالفة (السطر غير موجود/غير تاريخي/محسوم، سطر هدف خارج فاتورته، سبب فارغ، مراجِع مجهول)
     */
    public function resolve(string $creditNoteLineId, string $outcome, ?string $sourceLineId, string $reason, string $reviewerEmail): CreditNoteLegacyReview
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('نطاق المستأجر مطلوب.');
        }
        if (! in_array($outcome, [CreditNoteLegacyReview::ATTRIBUTED, CreditNoteLegacyReview::NOT_APPLICABLE], true)) {
            throw new RuntimeException('نتيجة المراجعة غير معروفة.');
        }
        $reason = trim($reason);
        if (mb_strlen($reason) < 10) {
            throw new RuntimeException('سبب المراجعة إلزامي (10 أحرف على الأقل).');
        }
        $reviewer = User::query()->where('tenant_id', $tenantId)->where('email', $reviewerEmail)->first();
        if ($reviewer === null) {
            throw new RuntimeException('المراجِع غير موجود في هذه المؤسسة.');
        }

        return DB::transaction(function () use ($creditNoteLineId, $outcome, $sourceLineId, $reason, $reviewer) {
            $line = CreditNoteLine::query()->with('creditNote')->lockForUpdate()->find($creditNoteLineId);
            $note = $line?->creditNote;
            if ($line === null || $note === null || $note->status !== 'posted' || $note->original_invoice_id === null) {
                throw new RuntimeException('السطر غير موجود أو ليس سطر إشعارٍ مرحَّل مرتبط بفاتورة.');
            }

            $current = collect($this->allocator->legacyCreditLines([(string) $note->original_invoice_id]))
                ->first(fn ($i) => $i['line']->id === $line->id);
            if ($current === null || $current['status'] !== 'unresolved') {
                throw new RuntimeException('هذا السطر محسومٌ بالفعل (مربوط بسطر أو سبق قرار مراجعته).');
            }

            if ($outcome === CreditNoteLegacyReview::ATTRIBUTED) {
                $target = $sourceLineId === null ? null : InvoiceLine::query()->find($sourceLineId);
                if ($target === null || $target->invoice_id !== $note->original_invoice_id) {
                    throw new RuntimeException('سطر الفاتورة المحدَّد لا يخص الفاتورة المصدر لهذا الإشعار.');
                }
            } else {
                $sourceLineId = null;
            }

            return CreditNoteLegacyReview::query()->create([
                'credit_note_line_id' => $line->id,
                'outcome' => $outcome,
                'source_line_id' => $sourceLineId,
                'reason' => $reason,
                'reviewed_by' => $reviewer->id,
                'reviewed_at' => now(),
            ]);
        });
    }
}

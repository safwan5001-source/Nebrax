<?php

namespace App\Services\Accounting;

use App\Models\ManualJournal;
use App\Models\ManualJournalLine;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة القيد اليدوي:
 * - المسودة وستورها مصدر تعليمات قابل للتعديل.
 * - الترحيل يستدعي LedgerService فقط، فينشئ JournalEntry متوازناً وغير قابل للتعديل.
 * - العكس محصور في القيد اليدوي المرحّل ولا يغيّر مستندات تشغيلية أخرى.
 */
class ManualJournalService
{
    public function __construct(protected LedgerService $ledger) {}

    /**
     * @param array $data ['entry_date'=>?, 'description'=>?, 'branch_id'=>?, 'created_by'=>?]
     * @param array $lines [['account_id'=>uuid, 'description'=>?, 'debit'=>int, 'credit'=>int,
     *                      'partner_id'=>?uuid, 'cost_center_id'=>?uuid], ...]
     */
    public function create(array $data, array $lines): ManualJournal
    {
        return DB::transaction(function () use ($data, $lines) {
            $date = $data['entry_date'] ?? now()->toDateString();
            $attributes = [
                'number'      => ManualJournal::nextDocumentNumber(
                    'MJE',
                    $date,
                    array_key_exists('branch_id', $data) ? $data['branch_id'] : false
                ),
                'entry_date'  => $date,
                'description' => $data['description'] ?? null,
                'status'      => 'draft',
                'created_by'  => $data['created_by'] ?? null,
            ];
            if (array_key_exists('branch_id', $data)) {
                $attributes['branch_id'] = $data['branch_id'];
            }

            $journal = ManualJournal::create($attributes);
            $this->replaceLines($journal, $lines);

            return $journal->load('lines.account', 'lines.costCenter');
        });
    }

    /** تعديل مسودة فقط؛ القيد المرحّل لا يعود إلى هيئة مسودة. */
    public function update(ManualJournal $journal, array $data, array $lines): ManualJournal
    {
        return DB::transaction(function () use ($journal, $data, $lines) {
            $journal = ManualJournal::lockForUpdate()->findOrFail($journal->id);
            if (! $journal->isDraft()) {
                throw new RuntimeException('لا يمكن تعديل قيد يدوي مرحّل أو معكوس.');
            }

            $journal->update([
                'entry_date'  => $data['entry_date'] ?? $journal->entry_date->toDateString(),
                'description' => $data['description'] ?? null,
            ]);
            $journal->lines()->delete();
            $this->replaceLines($journal, $lines);

            return $journal->fresh(['lines.account', 'lines.costCenter']);
        });
    }

    /** النسخ ينشئ مسودة جديدة مستقلة برقم وتاريخ جديدين، لا أثراً محاسبياً جديداً. */
    public function duplicate(ManualJournal $journal, ?string $createdBy = null): ManualJournal
    {
        $journal->loadMissing('lines');

        return $this->create([
            'entry_date' => now()->toDateString(),
            'description' => $journal->description,
            'branch_id' => $journal->branch_id,
            'created_by' => $createdBy,
        ], $journal->lines->map(fn (ManualJournalLine $line) => [
            'account_id' => $line->account_id,
            'description' => $line->description,
            'debit' => $line->debit,
            'credit' => $line->credit,
            'partner_id' => $line->partner_id,
            'cost_center_id' => $line->cost_center_id,
        ])->all());
    }

    /** حذف المسودة فقط. */
    public function deleteDraft(ManualJournal $journal): void
    {
        DB::transaction(function () use ($journal) {
            $journal = ManualJournal::lockForUpdate()->findOrFail($journal->id);
            if (! $journal->isDraft()) {
                throw new RuntimeException('لا يمكن حذف قيد يدوي مرحّل أو معكوس.');
            }

            $journal->delete();
        });
    }

    /** ترحيل المسودة عبر المحرك المركزي، لا بكتابة مباشرة في دفتر اليومية. */
    public function post(ManualJournal $journal): ManualJournal
    {
        if (! $journal->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل قيد يدوي غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($journal) {
            $journal = ManualJournal::lockForUpdate()->with('lines')->findOrFail($journal->id);
            if (! $journal->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل قيد يدوي غير مسوّد (draft).');
            }
            if ($journal->lines->count() < 2) {
                throw new RuntimeException('القيد اليدوي يحتاج سطرين على الأقل.');
            }

            $entry = $this->ledger->post(
                $journal->lines->map(fn (ManualJournalLine $line) => array_filter([
                    'account_id' => $line->account_id,
                    'description' => $line->description,
                    'debit' => $line->debit,
                    'credit' => $line->credit,
                    'partner_type' => $line->partner_id ? \App\Models\Partner::class : null,
                    'partner_id' => $line->partner_id,
                    'cost_center_id' => $line->cost_center_id,
                ], fn ($value) => $value !== null))->all(),
                [
                    'entry_date'  => $journal->entry_date->toDateString(),
                    'description' => $journal->description ?: "قيد يدوي {$journal->number}",
                    'source_type' => ManualJournal::class,
                    'source_id'   => $journal->id,
                    'created_by'  => $journal->created_by,
                    // null مقصود لقيد مركزي؛ لا يُستبدل بالفرع النشط داخل المحرك.
                    'branch_id'   => $journal->branch_id,
                ]
            );

            $journal->update([
                'status'           => 'posted',
                'journal_entry_id' => $entry->id,
            ]);

            return $journal->fresh(['lines.account', 'lines.costCenter', 'journalEntry.lines']);
        });
    }

    /**
     * يعكس فقط قيداً ناشئاً من المسودة اليدوية، فيحافظ على فصل تصحيحات المستندات
     * التشغيلية (فواتير/مدفوعات/مخزون) عن عكس القيد المجرد.
     */
    public function reverse(ManualJournal $journal, ?string $date = null, ?string $reason = null): ManualJournal
    {
        if (! $journal->isPosted() || ! $journal->journal_entry_id) {
            throw new RuntimeException('لا يمكن عكس قيد يدوي غير مرحّل.');
        }

        return DB::transaction(function () use ($journal, $date, $reason) {
            $journal = ManualJournal::lockForUpdate()->with('journalEntry.lines')->findOrFail($journal->id);
            if (! $journal->isPosted() || ! $journal->journalEntry) {
                throw new RuntimeException('لا يمكن عكس قيد يدوي غير مرحّل.');
            }

            $this->ledger->reverse($journal->journalEntry, $date, $reason ?: "عكس القيد اليدوي {$journal->number}");
            $journal->update(['status' => 'reversed']);

            return $journal->fresh(['lines.account', 'lines.costCenter', 'journalEntry.lines']);
        });
    }

    /** يحفظ ترتيب السطور وبياناتها كما سيحتاجها المحرك عند الترحيل. */
    private function replaceLines(ManualJournal $journal, array $lines): void
    {
        foreach (array_values($lines) as $index => $line) {
            ManualJournalLine::create([
                'manual_journal_id' => $journal->id,
                'account_id'        => $line['account_id'],
                'description'       => $line['description'] ?? null,
                'debit'             => (int) ($line['debit'] ?? 0),
                'credit'            => (int) ($line['credit'] ?? 0),
                'partner_id'        => $line['partner_id'] ?? null,
                'cost_center_id'    => $line['cost_center_id'] ?? null,
                'sort_order'        => $index + 1,
            ]);
        }
    }
}

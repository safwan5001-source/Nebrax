<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountBalance;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  LedgerService — محرك القيد المزدوج
 * ═══════════════════════════════════════════════════════════════
 *  المبدأ: كل معاملة مالية = قيد متوازن (Σ مدين = Σ دائن).
 *  - كل المبالغ بالـ minor units (هللات) كأعداد صحيحة.
 *  - القيود المرحّلة immutable — التصحيح بقيد عكسي فقط.
 *  - يُحدّث لقطات الأرصدة ذرّياً داخل transaction.
 */
class LedgerService
{
    public function __construct(
        protected TenantContext $tenant
    ) {}

    /**
     * إنشاء وترحيل قيد متوازن.
     *
     * @param  array  $lines  [['account_id'=>uuid,'debit'=>int,'credit'=>int,'description'=>?,'partner_type'=>?,'partner_id'=>?], ...]
     * @param  array  $meta   ['entry_date'=>?, 'description'=>?, 'source_type'=>?, 'source_id'=>?, 'created_by'=>?]
     */
    public function post(array $lines, array $meta = []): JournalEntry
    {
        $this->validateBalanced($lines);

        return DB::transaction(function () use ($lines, $meta) {
            $entry = JournalEntry::create([
                'number'      => $this->nextNumber($meta['entry_date'] ?? now()->toDateString()),
                'entry_date'  => $meta['entry_date'] ?? now()->toDateString(),
                'description' => $meta['description'] ?? null,
                'status'      => 'posted',
                'source_type' => $meta['source_type'] ?? null,
                'source_id'   => $meta['source_id'] ?? null,
                'created_by'  => $meta['created_by'] ?? null,
                'posted_at'   => now(),
            ]);

            foreach ($lines as $line) {
                $this->assertPostable($line['account_id']);

                JournalLine::create([
                    'journal_entry_id' => $entry->id,
                    'account_id'       => $line['account_id'],
                    'debit'            => (int) ($line['debit'] ?? 0),
                    'credit'           => (int) ($line['credit'] ?? 0),
                    'description'      => $line['description'] ?? null,
                    'partner_type'     => $line['partner_type'] ?? null,
                    'partner_id'       => $line['partner_id'] ?? null,
                ]);

                $this->applyToBalance(
                    $line['account_id'],
                    (int) ($line['debit'] ?? 0),
                    (int) ($line['credit'] ?? 0)
                );
            }

            return $entry->load('lines');
        });
    }

    /**
     * عكس قيد مرحّل (التصحيح الوحيد المسموح).
     * يُنشئ قيداً معكوس السطور ويربطه بالأصل.
     */
    public function reverse(JournalEntry $entry, ?string $date = null, ?string $reason = null): JournalEntry
    {
        if (! $entry->isPosted()) {
            throw new RuntimeException('لا يمكن عكس قيد غير مرحّل.');
        }

        return DB::transaction(function () use ($entry, $date, $reason) {
            $reversal = JournalEntry::create([
                'number'      => $this->nextNumber($date ?? now()->toDateString()),
                'entry_date'  => $date ?? now()->toDateString(),
                'description' => $reason ?? "عكس القيد {$entry->number}",
                'status'      => 'posted',
                'reversal_of' => $entry->id,
                'posted_at'   => now(),
            ]);

            foreach ($entry->lines as $line) {
                // عكس: المدين يصبح دائناً والعكس
                JournalLine::create([
                    'journal_entry_id' => $reversal->id,
                    'account_id'       => $line->account_id,
                    'debit'            => $line->credit,
                    'credit'           => $line->debit,
                    'description'      => "عكس: {$line->description}",
                    'partner_type'     => $line->partner_type,
                    'partner_id'       => $line->partner_id,
                ]);

                $this->applyToBalance($line->account_id, $line->credit, $line->debit);
            }

            $entry->update(['status' => 'reversed']);

            return $reversal->load('lines');
        });
    }

    /**
     * التحقق من توازن القيد قبل الترحيل.
     */
    protected function validateBalanced(array $lines): void
    {
        if (count($lines) < 2) {
            throw new RuntimeException('القيد يجب أن يحتوي على سطرين على الأقل.');
        }

        $debit = $credit = 0;
        foreach ($lines as $line) {
            $d = (int) ($line['debit'] ?? 0);
            $c = (int) ($line['credit'] ?? 0);

            if ($d < 0 || $c < 0) {
                throw new RuntimeException('المبالغ يجب أن تكون موجبة.');
            }
            if ($d > 0 && $c > 0) {
                throw new RuntimeException('السطر لا يمكن أن يكون مديناً ودائناً معاً.');
            }
            $debit += $d;
            $credit += $c;
        }

        if ($debit !== $credit) {
            throw new RuntimeException(
                "القيد غير متوازن: مدين {$debit} ≠ دائن {$credit}."
            );
        }
        if ($debit === 0) {
            throw new RuntimeException('القيد لا يمكن أن يكون صفرياً.');
        }
    }

    /**
     * يضمن أن الحساب قابل للترحيل المباشر (ليس تجميعياً).
     */
    protected function assertPostable(string $accountId): void
    {
        $account = Account::findOrFail($accountId);
        if ($account->is_group) {
            throw new RuntimeException("الحساب التجميعي '{$account->name}' لا يقبل قيوداً مباشرة.");
        }
        if (! $account->is_active) {
            throw new RuntimeException("الحساب '{$account->name}' غير مفعّل.");
        }
    }

    /**
     * تحديث لقطة رصيد الحساب ذرّياً.
     * الرصيد يُحسب حسب الطبيعة: مدين الطبيعة => debit - credit، والعكس.
     */
    protected function applyToBalance(string $accountId, int $debit, int $credit): void
    {
        $account = Account::findOrFail($accountId);
        $delta = $account->normal_balance === 'debit'
            ? ($debit - $credit)
            : ($credit - $debit);

        $balance = AccountBalance::firstOrCreate(
            ['account_id' => $accountId],
            ['balance' => 0, 'total_debit' => 0, 'total_credit' => 0]
        );

        $balance->increment('balance', $delta);
        $balance->increment('total_debit', $debit);
        $balance->increment('total_credit', $credit);
    }

    /**
     * توليد رقم قيد تسلسلي: JE-2025-00001
     */
    protected function nextNumber(string $date): string
    {
        $year = substr($date, 0, 4);
        $count = JournalEntry::whereYear('entry_date', $year)->count() + 1;

        return sprintf('JE-%s-%05d', $year, $count);
    }
}

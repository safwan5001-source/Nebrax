<?php

namespace App\Services\Accounting;

use App\Models\CashBankAccount;
use App\Models\CashBankTransfer;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/** ينفّذ التحويل الآني بين خزائن وحسابات من العملة نفسها وقيده المتوازن. */
class CashBankTransferService
{
    public function __construct(
        protected LedgerService $ledger,
        protected CashBankAccountService $cashBankAccounts,
    ) {}

    public function transfer(array $data, ?User $actor = null): CashBankTransfer
    {
        $amount = (int) ($data['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('مبلغ التحويل يجب أن يكون موجباً.');
        }
        if (($data['source_cash_bank_account_id'] ?? null) === ($data['destination_cash_bank_account_id'] ?? null)) {
            throw new RuntimeException('لا يمكن التحويل إلى الخزينة أو الحساب نفسه.');
        }

        return DB::transaction(function () use ($data, $amount, $actor) {
            // ترتيب القفل ثابت لتفادي تعارض تحويلين متعاكسين.
            $ids = [$data['source_cash_bank_account_id'], $data['destination_cash_bank_account_id']];
            sort($ids);
            $locked = CashBankAccount::whereIn('id', $ids)->with('account')->lockForUpdate()->get()->keyBy('id');
            $source = $locked->get($data['source_cash_bank_account_id']);
            $destination = $locked->get($data['destination_cash_bank_account_id']);

            if (! $source || ! $destination) {
                throw new RuntimeException('الخزينة أو الحساب البنكي المختار غير موجود.');
            }
            if (! $source->is_active || ! $destination->is_active || ! $source->account->is_active || ! $destination->account->is_active) {
                throw new RuntimeException('لا يمكن التحويل من أو إلى حساب معطّل.');
            }
            if ($source->currency !== $destination->currency) {
                throw new RuntimeException('التحويل بين عملتين مختلفتين غير متاح في هذه المرحلة.');
            }

            $this->cashBankAccounts->assertAllowed($source, 'withdraw', $actor);
            $this->cashBankAccounts->assertAllowed($destination, 'deposit', $actor);

            // سياسة مستأجر قابلة للضبط، والافتراض المالي الآمن يمنع السالب.
            $sourceBalance = (int) $source->account->balance()->value('balance');
            if (! Settings::get('finance', 'allow_negative_transfer_balance') && $sourceBalance < $amount) {
                throw new RuntimeException('رصيد الخزينة أو الحساب المصدر غير كافٍ للتحويل. فعّل السماح بالرصيد السالب من إعدادات المالية إن كانت سياستك تسمح بذلك.');
            }

            $date = $data['transfer_date'] ?? now()->toDateString();
            $transfer = CashBankTransfer::create([
                'number' => CashBankTransfer::nextDocumentNumber('CBT', $date),
                'source_cash_bank_account_id' => $source->id,
                'destination_cash_bank_account_id' => $destination->id,
                'amount' => $amount,
                'currency' => $source->currency,
                'transfer_date' => $date,
                'reference' => $data['reference'] ?? null,
                'notes' => $data['notes'] ?? null,
                'created_by' => $actor?->id,
            ]);

            // تحويل داخلي: وجهة مدينة ومصدر دائن بالقيمة نفسها. لا إيراد أو مصروف.
            $entry = $this->ledger->post([
                ['account_id' => $destination->account_id, 'debit' => $amount, 'description' => "تحويل {$transfer->number}"],
                ['account_id' => $source->account_id, 'credit' => $amount, 'description' => "تحويل {$transfer->number}"],
            ], [
                'entry_date' => $date,
                'description' => "تحويل {$transfer->number}: {$source->name} ← {$destination->name}",
                'source_type' => CashBankTransfer::class,
                'source_id' => $transfer->id,
                'created_by' => $actor?->id,
            ]);

            $transfer->update(['journal_entry_id' => $entry->id]);

            return $transfer->fresh()->load(['source.account.balance', 'destination.account.balance', 'journalEntry']);
        });
    }
}

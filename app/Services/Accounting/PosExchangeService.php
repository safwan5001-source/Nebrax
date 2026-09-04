<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PosExchange;
use App\Models\PosExchangeAttempt;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Services\Pos\PosIdempotencyConflictException;
use App\Support\PosSettings;
use App\Tenancy\BranchContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * استبدال POS = مرتجع مبيعات + بيع بديل داخل معاملة واحدة.
 *
 * لا يوجد «قيد صافي» للاستبدال: يبقى كل من المرتجع والبيع مرجعاً محاسبياً
 * مستقلاً عبر محركيه، ويعالج هذا المنسق فقط ربط رصيد العميل وتسوية فائضه.
 *
 * R4 — idempotency durable على نمط PosService::checkout: مفتاح واحد يحمي
 * العملية الذرية الكاملة (مرتجع + بديل + تسوية فائض) عبر `PosExchangeAttempt`.
 * لا يمرَّر هذا المفتاح إلى `PosReturnService::create()` الداخلي — انظر
 * توثيق ذلك في رأس PosReturnService.
 */
class PosExchangeService
{
    private const ACC_CASH = '1110';
    private const ACC_RECEIVABLE = '1130';

    public function __construct(
        protected PosReturnService $returns,
        protected PosService $sales,
        protected PosSessionService $sessions,
        protected LedgerService $ledger,
    ) {}

    /**
     * معاينة بلا كتابة: تكشف للواجهة قيمة المرتجع وأهلية رد فائضه النقدي قبل أن
     * تعطي الكاشير خيار النقد. قيمة الفائض هنا للعرض فقط ويعاد التحقق منها عند الترحيل.
     *
     * @return array{return_total:int,exchange_surplus_policy:string,cash_allowed:bool,cash_block_reason:?string}
     */
    public function quote(array $data, User $actor): array
    {
        $quote = $this->returns->quote([
            'pos_session_id' => $data['pos_session_id'],
            'original_invoice_id' => $data['original_invoice_id'],
            'payment_type' => 'credit',
            'items' => $data['return_items'],
        ], $actor);
        $cashSurplus = max(0, (int) ($data['cash_surplus_amount'] ?? 0));
        $policy = PosSettings::exchangeSurplusPolicy();
        $cashBlockReason = null;

        if ($cashSurplus > 0 && $policy !== PosSettings::EXCHANGE_SURPLUS_ALLOW_CASH_REFUND) {
            $cashBlockReason = 'إعدادات نقطة البيع تجعل فائض الاستبدال رصيداً للعميل فقط.';
        } elseif ($cashSurplus > 0) {
            $cashBlockReason = $this->returns->cashRefundBlockReason($quote['invoice'], $quote['session'], $cashSurplus);
        }

        return [
            'return_total' => $quote['total'],
            'exchange_surplus_policy' => $policy,
            'cash_allowed' => $cashBlockReason === null,
            'cash_block_reason' => $cashBlockReason,
        ];
    }

    /**
     * @param array{idempotency_key:string,pos_session_id:string,original_invoice_id:string,return_items:array<int,array{source_line_id:string,quantity:int}>,restock?:bool,surplus_refund_method?:string,notes?:string,replacement:array{items:array,tenders:array,tax_inclusive?:bool}} $data
     * @return array{exchange:PosExchange,return:ReturnDocument,replacement:Invoice,idempotent_replay?:bool}
     */
    public function create(array $data, User $actor): array
    {
        $idempotencyKey = $this->requireIdempotencyKey($data['idempotency_key'] ?? null);
        $checksum = $this->exchangeRequestChecksum($data);

        try {
            return DB::transaction(function () use ($data, $actor, $idempotencyKey, $checksum) {
                // مرساة ثابتة لكل فرع: تمنع سباق المفتاح نفسه حتى مع جلسات متوازية.
                $branchId = app(BranchContext::class)->id();
                if (! is_string($branchId) || $branchId === '') {
                    throw new RuntimeException('فرع نقطة البيع غير محدد.');
                }
                Branch::query()->whereKey($branchId)->lockForUpdate()->firstOrFail();

                $existing = PosExchangeAttempt::query()
                    ->where('idempotency_key', $idempotencyKey)
                    ->lockForUpdate()
                    ->first();
                if ($existing !== null) {
                    if (! hash_equals($existing->request_checksum, $checksum)) {
                        throw new PosIdempotencyConflictException('تم استخدام مفتاح إعادة الطلب مع محتوى مختلف.');
                    }

                    return $this->replayExchangeAttempt($existing);
                }

                $result = $this->buildAndPostExchange($data, $actor);

                PosExchangeAttempt::withWriting(fn () => PosExchangeAttempt::create([
                    'idempotency_key' => $idempotencyKey,
                    'request_checksum' => $checksum,
                    'exchange_id' => $result['exchange']->id,
                    'pos_session_id' => $result['exchange']->pos_session_id,
                    'created_by' => $actor->id,
                    'created_at' => now(),
                ]));

                return $result;
            });
        } catch (QueryException $exception) {
            // سباق متزامن على نفس المفتاح: القيد الفريد يمنع الصف المكرر؛
            // نعيد الاستبدال الفائز بدل 500 كي تبقى إعادة المحاولة Idempotent.
            if ($this->isUniqueConstraintViolation($exception)) {
                $existing = PosExchangeAttempt::query()
                    ->where('idempotency_key', $idempotencyKey)
                    ->first();
                if ($existing !== null) {
                    if (! hash_equals($existing->request_checksum, $checksum)) {
                        throw new PosIdempotencyConflictException('تم استخدام مفتاح إعادة الطلب مع محتوى مختلف.');
                    }

                    return $this->replayExchangeAttempt($existing);
                }
            }
            throw $exception;
        }
    }

    /** يبني ويرحّل الاستبدال الكامل — منطق الإنشاء الفعلي، بمعزل عن طبقة idempotency. */
    private function buildAndPostExchange(array $data, User $actor): array
    {
        // يثبت قفل الجلسة والكاشير والفرع قبل أي مستند، وتعيد خدمة المرتجع
        // التحقق نفسه من فاتورة المصدر وكمية السطور المسموح بها. لا يمرَّر
        // idempotency_key هنا — المرساة الخارجية أعلاه تحمي العملية كاملة.
        $return = $this->returns->create([
            'pos_session_id' => $data['pos_session_id'],
            'original_invoice_id' => $data['original_invoice_id'],
            'payment_type' => 'credit',
            'items' => $data['return_items'],
            'restock' => $data['restock'] ?? null,
            'notes' => $data['notes'] ?? null,
        ], $actor);
        $returnTotal = (int) $return->total;
        if ($returnTotal <= 0) {
            throw new RuntimeException('الاستبدال يحتاج مرتجعاً ذا قيمة موجبة.');
        }

        $session = $this->sessions->requireOpenForCheckout($data['pos_session_id'], $actor->id, $actor);
        $source = Invoice::findOrFail($data['original_invoice_id']);
        if ($source->partner_id !== $return->partner_id) {
            throw new RuntimeException('فاتورة الاستبدال والمرتجع لا تخصان العميل نفسه.');
        }

        // رصيد المرتجع لا يصل من العميل: يحقن الخادم كامل قيمته في البيع،
        // وPosService يطبّق منه فقط ما يحتاجه البديل ثم يحصّل الفرق الحقيقي.
        $replacementData = $data['replacement'];
        $requestedTenders = $replacementData['tenders'] ?? [];
        $requestedCredit = max(0, (int) ($requestedTenders['credit'] ?? 0));
        $replacement = $this->sales->checkout([
            'partner_id' => $source->partner_id,
            'pos_session_id' => $session->id,
            'warehouse_id' => $session->warehouse_id,
            // مفتاح خادمي لكل استبدال: الاستبدال عملية منطقية جديدة وليست إعادة إرسال POS.
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            'tax_inclusive' => (bool) ($replacementData['tax_inclusive'] ?? false),
            'items' => $replacementData['items'],
            'tenders' => array_merge($requestedTenders, ['credit' => $returnTotal + $requestedCredit]),
            'notes' => "استبدال POS مقابل {$source->number}",
            'created_by' => $actor->id,
            'minimum_price_override_actor_id' => $actor->id,
            'actor' => $actor,
        ]);

        $appliedCredit = min($returnTotal, (int) $replacement->total);
        $surplus = $returnTotal - $appliedCredit;
        $refundMethod = $data['surplus_refund_method'] ?? 'credit';
        if ($surplus <= 0 && $refundMethod === 'cash') {
            throw new RuntimeException('لا يوجد فائض مرتجع يمكن رده نقداً في هذا الاستبدال.');
        }
        if ($surplus > 0 && $refundMethod === 'cash'
            && PosSettings::exchangeSurplusPolicy() !== PosSettings::EXCHANGE_SURPLUS_ALLOW_CASH_REFUND) {
            throw new RuntimeException('إعدادات نقطة البيع تجعل فائض الاستبدال رصيداً للعميل فقط.');
        }
        if ($surplus > 0 && $refundMethod === 'cash') {
            $blockReason = $this->returns->cashRefundBlockReason($source, $session, $surplus);
            if ($blockReason !== null) {
                throw new RuntimeException($blockReason);
            }
        }

        // PosService يحدّث فقط ما حُصّل فعلياً؛ تطبيق رصيد المرتجع يصفّر
        // المتبقي على الفاتورة البديلة بلا سند قبض وهمي ولا تغير في قيدها.
        $paidAfterTenders = (int) $replacement->paid_amount;
        $paid = min((int) $replacement->total, $paidAfterTenders + $appliedCredit);
        $replacement->update([
            'paid_amount' => $paid,
            'payment_status' => $paid >= (int) $replacement->total ? 'paid' : ($paid > 0 ? 'partial' : 'unpaid'),
            'is_paid' => $paid >= (int) $replacement->total,
        ]);

        $exchange = PosExchange::create([
            'branch_id' => $session->branch_id,
            'pos_session_id' => $session->id,
            'original_invoice_id' => $source->id,
            'return_id' => $return->id,
            'replacement_invoice_id' => $replacement->id,
            'applied_credit_amount' => $appliedCredit,
            'cash_refund_amount' => 0,
            'status' => 'draft',
            'notes' => $data['notes'] ?? null,
            'created_by' => $actor->id,
        ]);

        $settlementEntryId = null;
        if ($surplus > 0 && $refundMethod === 'cash') {
            $settlementEntryId = $this->postCashSurplus($exchange, $source, $surplus, $actor);
        }

        $exchange->update([
            'cash_refund_amount' => $settlementEntryId ? $surplus : 0,
            'journal_entry_id' => $settlementEntryId,
            'status' => 'posted',
        ]);
        $exchange = $exchange->fresh();
        $this->sessions->recordExchange($session, $exchange, $actor);

        return [
            'exchange' => $exchange,
            'return' => $return,
            'replacement' => $replacement->fresh('lines'),
        ];
    }

    private function replayExchangeAttempt(PosExchangeAttempt $attempt): array
    {
        $exchange = PosExchange::query()->findOrFail($attempt->exchange_id);

        return [
            'exchange' => $exchange,
            'return' => ReturnDocument::with('lines')->find($exchange->return_id),
            'replacement' => Invoice::with('lines')->find($exchange->replacement_invoice_id),
            'idempotent_replay' => true,
        ];
    }

    private function requireIdempotencyKey(mixed $key): string
    {
        if (! is_string($key) || $key === '' || ! preg_match('/^[0-9a-fA-F-]{36}$/', $key)) {
            throw new RuntimeException('مفتاح إعادة المحاولة مطلوب ويجب أن يكون UUID صالحاً.');
        }

        return $key;
    }

    /**
     * checksum دلالي مستقر لحمولة الاستبدال — لا يشمل الفاعل. يغطي طرفَي
     * العملية معاً (المرتجع والبديل) لأن مفتاحاً واحداً يحميهما كوحدة ذرية.
     */
    private function exchangeRequestChecksum(array $data): string
    {
        $returnItems = [];
        foreach ($data['return_items'] ?? [] as $item) {
            if (! is_array($item)) {
                continue;
            }
            $returnItems[] = [
                'source_line_id' => $item['source_line_id'] ?? null,
                'quantity' => (int) ($item['quantity'] ?? 0),
            ];
        }
        usort($returnItems, fn (array $a, array $b) => strcmp((string) $a['source_line_id'], (string) $b['source_line_id']));

        $replacementData = $data['replacement'] ?? [];
        $replacementItems = [];
        foreach ($replacementData['items'] ?? [] as $item) {
            if (! is_array($item)) {
                continue;
            }
            $replacementItems[] = [
                'product_id' => $item['product_id'] ?? null,
                'description' => $item['description'] ?? null,
                'quantity' => (int) ($item['quantity'] ?? 0),
                'unit_price' => (int) ($item['unit_price'] ?? 0),
                'tax_rate' => (int) ($item['tax_rate'] ?? 0),
                'discount' => (int) ($item['discount'] ?? 0),
            ];
        }
        usort($replacementItems, fn (array $a, array $b) => strcmp(json_encode($a), json_encode($b)));

        $tenders = $replacementData['tenders'] ?? [];
        $normalizedTenders = [
            'cash' => (int) ($tenders['cash'] ?? 0),
            'card' => (int) ($tenders['card'] ?? 0),
            'transfer' => (int) ($tenders['transfer'] ?? 0),
            'credit' => (int) ($tenders['credit'] ?? 0),
        ];

        $payload = [
            'pos_session_id' => $data['pos_session_id'] ?? null,
            'original_invoice_id' => $data['original_invoice_id'] ?? null,
            'return_items' => $returnItems,
            'restock' => array_key_exists('restock', $data) ? (bool) $data['restock'] : null,
            'surplus_refund_method' => $data['surplus_refund_method'] ?? null,
            'notes' => $data['notes'] ?? null,
            'replacement' => [
                'tax_inclusive' => (bool) ($replacementData['tax_inclusive'] ?? false),
                'items' => $replacementItems,
                'tenders' => $normalizedTenders,
            ],
        ];

        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    private function isUniqueConstraintViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        // PostgreSQL unique_violation = 23505 · SQLite constraint = 19
        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /** يسدد رصيد العميل نقداً؛ لا ينشئ سند قبض/صرف لأن المصدر مرتجع مبيعات مثبت. */
    private function postCashSurplus(PosExchange $exchange, Invoice $source, int $amount, User $actor): string
    {
        $entry = $this->ledger->post([
            [
                'account_id' => $this->accountId(self::ACC_RECEIVABLE),
                'debit' => $amount,
                'partner_type' => Partner::class,
                'partner_id' => $source->partner_id,
            ],
            ['account_id' => $this->accountId(self::ACC_CASH), 'credit' => $amount],
        ], [
            'entry_date' => now()->toDateString(),
            'description' => "رد فرق استبدال POS {$exchange->id}",
            'source_type' => PosExchange::class,
            'source_id' => $exchange->id,
            'created_by' => $actor->id,
        ]);

        return $entry->id;
    }

    private function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }
}

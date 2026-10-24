<?php

namespace App\Services\Accounting;

use App\Models\CashBankAccount;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementItem;
use App\Models\PaymentGatewaySettlementLine;
use App\Models\PaymentRefund;
use App\Models\User;
use App\Services\PaymentsRolloutControlService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class PaymentGatewaySettlementService
{
    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly LedgerService $ledger,
        private readonly AccountRoleResolver $accountRoles,
        private readonly CashBankAccountService $cashBankAccounts,
        private readonly PaymentsRolloutControlService $rollout,
    ) {
    }

    /** ترحيل صارم: أي فرق غير مفسَّر يُرفض (السلوك القائم). */
    public function post(array $input, ?User $actor = null): PaymentGatewaySettlement
    {
        return $this->process($input, $actor, false);
    }

    /**
     * تسجيل التسوية (PAY-H3-02b، D-21): فرق صفري ⇒ ترحيل بقيد واحد؛ فرق غير مفسَّر ⇒ تُحفظ `unreconciled` بفرقها بلا قيد ولا استهلاك
     * (لا حساب فروقات عام). إعادة الإرسال بالمرجع نفسه تحدّث المسودة، وتُرحَّل متى صار الفرق صفراً.
     */
    public function record(array $input, ?User $actor = null): PaymentGatewaySettlement
    {
        return $this->process($input, $actor, true);
    }

    private function process(array $input, ?User $actor, bool $allowUnreconciled): PaymentGatewaySettlement
    {
        $tenantId = $this->requireTenant();

        $gatewayId = (string) ($input['payment_gateway_id'] ?? '');
        $cashBankId = (string) ($input['cash_bank_account_id'] ?? '');
        $ref = trim((string) ($input['provider_settlement_ref'] ?? ''));
        $date = (string) ($input['settlement_date'] ?? now()->toDateString());
        $itemsInput = $input['items'] ?? [];
        $refundsInput = $input['refunds'] ?? [];

        if ($gatewayId === '' || $cashBankId === '' || $ref === '') {
            throw new DomainException('Gateway settlement requires a gateway, bank destination, and provider reference.');
        }
        if (! is_array($itemsInput) || $itemsInput === []) {
            throw new DomainException('Gateway settlement requires at least one matched payment.');
        }
        if (! is_array($refundsInput)) {
            throw new DomainException('Settlement refunds must be a list.');
        }

        $net = $this->money($input['net_bank_amount'] ?? null, 'net bank amount');
        $feeExTax = $this->money($input['provider_fee_ex_tax'] ?? 0, 'provider fee');
        $feeTax = $this->money($input['provider_fee_tax'] ?? 0, 'provider fee tax');
        $deductions = $this->money($input['provider_deductions'] ?? 0, 'provider deductions');
        $credits = $this->money($input['provider_credits'] ?? 0, 'provider credits');

        if ($feeTax > 0) {
            throw new DomainException(
                'Provider fee tax posting is not authorized until an approved input-tax routing policy exists. Pass provider_fee_tax=0 or stop for a tax decision.'
            );
        }

        $this->assertUnsupportedAdjustmentsAreZero($deductions, $credits);

        return DB::transaction(function () use (
            $tenantId, $gatewayId, $cashBankId, $ref, $date, $itemsInput, $refundsInput,
            $net, $feeExTax, $feeTax, $deductions, $credits, $input, $actor, $allowUnreconciled
        ) {
            // ترتيب الأقفال: البوابة ← صفوف السندات ← صفوف الاستردادات ← مِرساة المستأجر (داخل LedgerService).
            $gateway = PaymentGateway::query()->whereKey($gatewayId)->lockForUpdate()->first();
            if ($gateway === null) {
                throw new DomainException('Payment gateway must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $gateway->tenant_id, 'Payment gateway');

            $existing = PaymentGatewaySettlement::query()
                ->where('payment_gateway_id', $gateway->id)
                ->where('provider_settlement_ref', $ref)
                ->lockForUpdate()
                ->first();

            if ($existing !== null && $existing->isPosted()) {
                return $this->replayOrReject($existing, $net, $feeExTax, $feeTax, $deductions, $credits, $itemsInput, $refundsInput);
            }

            // تفعيل المدفوعات الإلكترونية لهذه المؤسسة شرط للتسجيل الجديد (record)؛ الإيقاف الطارئ للمنصة لا يمنع تسوية مال وصل فعلاً (كترحيل A5)،
            // والتكرار الآمن لمرحَّلة قائمة يُعاد دائماً (idempotent) ولو عُطّلت المؤسسة بعدها.
            if ($allowUnreconciled && ! $this->rollout->effectiveForCurrentTenant()->tenantEnabled) {
                throw new DomainException('rollout_disabled: online payments are not enabled for this tenant.');
            }

            $cashEntity = CashBankAccount::query()->whereKey($cashBankId)->first();
            if ($cashEntity === null) {
                throw new DomainException('Cash bank account must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $cashEntity->tenant_id, 'Cash bank account');
            if (! $cashEntity->is_active) {
                throw new RuntimeException('الحساب البنكي المختار معطّل.');
            }
            $this->cashBankAccounts->assertAllowed($cashEntity, 'deposit', $actor);

            $clearing = $this->accountRoles->resolve('gateway_clearing');
            $feeAccount = $this->accountRoles->resolve('provider_fee_expense');
            $bankLedger = $cashEntity->account()->firstOrFail();
            $this->assertSameTenant($tenantId, (string) $clearing->tenant_id, 'Gateway clearing account');
            $this->assertSameTenant($tenantId, (string) $feeAccount->tenant_id, 'Provider fee account');
            $this->assertSameTenant($tenantId, (string) $bankLedger->tenant_id, 'Bank ledger account');

            $tenantCurrency = (string) (\App\Models\Tenant::query()->whereKey($tenantId)->value('currency') ?: 'SAR');
            $currency = (string) ($input['currency'] ?? $tenantCurrency);
            if ($currency !== $tenantCurrency) {
                throw new DomainException("currency_mismatch: settlement currency {$currency} must equal the tenant currency {$tenantCurrency}.");
            }
            $normalizedItems = $this->normalizeItems($tenantId, $gateway->id, $itemsInput);
            $gross = 0;
            foreach ($normalizedItems as $item) {
                $gross += $item['gross_amount'];
            }
            $normalizedRefunds = $this->normalizeRefunds($tenantId, $gateway->id, $currency, $refundsInput, true, $date);
            $refundsTotal = 0;
            foreach ($normalizedRefunds as $line) {
                $refundsTotal += $line['amount'];
            }

            $difference = $this->assertReconcilable($gross, $refundsTotal, $net, $feeExTax, $feeTax, $deductions, $credits, $allowUnreconciled);

            $header = [
                'payment_gateway_id' => $gateway->id,
                'cash_bank_account_id' => $cashEntity->id,
                'provider_settlement_ref' => $ref,
                'settlement_date' => $date,
                'gross_amount' => $gross,
                'net_bank_amount' => $net,
                'provider_fee_ex_tax' => $feeExTax,
                'provider_fee_tax' => $feeTax,
                'provider_deductions' => $deductions,
                'provider_credits' => $credits,
                'refunds_total' => $refundsTotal,
                'currency' => $currency,
                'gateway_provider' => $gateway->provider,
                'gateway_name' => $gateway->name,
                'clearing_account_id' => $clearing->id,
                'fee_expense_account_id' => $feeAccount->id,
                'bank_account_id' => $cashEntity->account_id,
            ];

            if ($difference !== 0) {
                // D-21: تُحفظ بفرقها وبلا قيد؛ لا تستهلك بنودها (الاستهلاك للمرحَّلة فقط).
                $settlement = $this->persistDraft($existing, $header + ['unreconciled_minor' => $difference, 'created_by' => $input['created_by'] ?? $actor?->id], $tenantId);
                $this->replaceChildren($settlement, $tenantId, $normalizedItems, $normalizedRefunds);

                return $settlement->fresh(['items', 'lines']);
            }

            $lines = $this->settlementLines($cashEntity->account_id, $feeAccount->id, $clearing->id, $net, $feeExTax, $gross, $normalizedRefunds);

            if ($existing !== null) {
                // مسودة `unreconciled`: تُحفظ الترويسة المصحَّحة أولاً (تعتمد عليها مُشغّلات البنود، كالعملة) بلا مساس بالحالة
                // ولا بالفرق غير الصفري؛ والانتقال إلى `posted` مع القيد يبقى تحديثاً واحداً أدناه.
                $settlement = $existing;
                $settlement->fill($header)->save();
            } else {
                $settlement = PaymentGatewaySettlement::create($header + [
                    'tenant_id' => $tenantId,
                    'status' => PaymentGatewaySettlement::STATUS_POSTED,
                    'created_by' => $input['created_by'] ?? $actor?->id,
                ]);
            }
            $this->replaceChildren($settlement, $tenantId, $normalizedItems, $normalizedRefunds);

            $entry = $this->ledger->post($lines, [
                'entry_date' => $date,
                'description' => "تسوية بوابة {$gateway->name} {$ref}",
                'source_type' => PaymentGatewaySettlement::class,
                'source_id' => $settlement->id,
                'created_by' => $settlement->created_by,
            ]);

            $settlement->forceFill(($existing !== null ? $header : []) + [
                'status' => PaymentGatewaySettlement::STATUS_POSTED,
                'unreconciled_minor' => null,
                'journal_entry_id' => $entry->id,
                'posted_at' => now(),
            ])->save();

            return $settlement->fresh(['items', 'lines', 'journalEntry.lines']);
        });
    }

    /** يحدّث مسودة `unreconciled` قائمة أو ينشئ واحدة؛ الترويسة قابلة للتعديل ما دامت لم تُرحَّل. */
    private function persistDraft(?PaymentGatewaySettlement $existing, array $header, string $tenantId): PaymentGatewaySettlement
    {
        if ($existing !== null) {
            $existing->fill($header)->save();

            return $existing;
        }

        return PaymentGatewaySettlement::create($header + ['tenant_id' => $tenantId, 'status' => PaymentGatewaySettlement::STATUS_UNRECONCILED]);
    }

    /** يستبدل بنود التحصيل والاسترداد (آمن: التسوية غير مرحَّلة بعد، ولا قيد). */
    private function replaceChildren(PaymentGatewaySettlement $settlement, string $tenantId, array $items, array $refunds): void
    {
        PaymentGatewaySettlementItem::query()->where('settlement_id', $settlement->id)->delete();
        PaymentGatewaySettlementLine::query()->where('settlement_id', $settlement->id)->delete();

        foreach ($items as $item) {
            PaymentGatewaySettlementItem::create([
                'tenant_id' => $tenantId,
                'settlement_id' => $settlement->id,
                'payment_id' => $item['payment_id'],
                'provider_event_ref' => $item['provider_event_ref'],
                'gross_amount' => $item['gross_amount'],
            ]);
        }
        foreach ($refunds as $line) {
            PaymentGatewaySettlementLine::create([
                'tenant_id' => $tenantId,
                'settlement_id' => $settlement->id,
                'line_type' => PaymentGatewaySettlementLine::TYPE_REFUND,
                'payment_refund_id' => $line['refund_id'],
                'amount_minor' => $line['amount'],
                'provider_event_ref' => $line['provider_event_ref'],
            ]);
        }
    }

    /**
     * معاينة المعادلة بلا أي كتابة (D-21): تُظهر الفرق وسبب عدم قابلية الترحيل بدل الرفض الصامت.
     * لا قيد ولا سجل تسوية ولا أقفال صفوف؛ تطبّق قواعد `process()` نفسها فيطابق «قابل للترحيل» ما سيقبله `post()`.
     * `saveable_as_unreconciled`: العائق الوحيد هو الفرق غير المفسَّر فيمكن حفظها `unreconciled` عبر `record()`.
     *
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function preview(array $input, ?User $actor = null): array
    {
        $tenantId = $this->requireTenant();
        $blockers = [];
        $block = function (string $code, string $message) use (&$blockers): void {
            $blockers[] = ['code' => $code, 'message' => $message];
        };

        $parse = function (string $key, string $label, bool $required = false) use ($input, $block): int {
            try {
                return $this->money($input[$key] ?? ($required ? null : 0), $label);
            } catch (DomainException $e) {
                $block('invalid_amount', $e->getMessage());

                return 0;
            }
        };
        $net = $parse('net_bank_amount', 'net bank amount', true);
        $feeExTax = $parse('provider_fee_ex_tax', 'provider fee');
        $feeTax = $parse('provider_fee_tax', 'provider fee tax');
        $deductions = $parse('provider_deductions', 'provider deductions');
        $credits = $parse('provider_credits', 'provider credits');

        $gateway = PaymentGateway::query()->whereKey((string) ($input['payment_gateway_id'] ?? ''))->first();
        if ($gateway === null) {
            $block('gateway_not_found', 'Payment gateway must belong to the active tenant.');
        }

        // مرجع التسوية موجود؟ post() يحسم التكرار قبل أي شرط خاص بالترحيل الجديد (بنك/أدوار/فترة)، فتتبعه المعاينة.
        $ref = trim((string) ($input['provider_settlement_ref'] ?? ''));
        if ($ref === '') {
            $block('reference_required', 'Gateway settlement requires a provider reference.');
        }
        $existing = $gateway !== null && $ref !== ''
            ? PaymentGatewaySettlement::query()->where('payment_gateway_id', $gateway->id)->where('provider_settlement_ref', $ref)->first()
            : null;
        $replay = $existing !== null && $existing->isPosted();

        if (! $replay) {
            // نفس شروط ما قبل الكتابة: حساب بنكي فعّال (وحسابه الدفتري حركي) ومسموح، أدوار الحسابات، وقفل الفترة.
            $cashEntity = CashBankAccount::query()->whereKey((string) ($input['cash_bank_account_id'] ?? ''))->first();
            if ($cashEntity === null) {
                $block('bank_account_not_found', 'Cash bank account must belong to the active tenant.');
            } else {
                if (! $cashEntity->is_active) {
                    $block('bank_account_inactive', 'الحساب البنكي المختار معطّل.');
                }
                $bankLedger = $cashEntity->account()->first();
                if ($bankLedger === null || ! $bankLedger->is_active) {
                    $block('bank_ledger_account_inactive', 'الحساب الدفتري للبنك غير موجود أو معطَّل.');
                } elseif ($bankLedger->is_group) {
                    $block('bank_ledger_account_group', 'الحساب الدفتري للبنك تجميعي ولا يقبل ترحيلاً مباشراً.');
                }
                try {
                    $this->cashBankAccounts->assertAllowed($cashEntity, 'deposit', $actor);
                } catch (\Throwable $e) {
                    $block('bank_account_forbidden', $e->getMessage());
                }
            }
            foreach (['gateway_clearing', 'provider_fee_expense'] as $role) {
                try {
                    $this->accountRoles->resolve($role);
                } catch (RuntimeException $e) {
                    $block('role_unmapped', $e->getMessage());
                }
            }
            try {
                app(AccountingDateGuard::class)->assertOpen((string) ($input['settlement_date'] ?? now()->toDateString()), 'تسوية البوابة');
            } catch (RuntimeException $e) {
                $block('period_locked', $e->getMessage());
            }
        }

        $gross = 0;
        $refundsTotal = 0;
        $itemsInput = $input['items'] ?? [];
        $refundsInput = $input['refunds'] ?? [];
        $tenantCurrency = (string) (\App\Models\Tenant::query()->whereKey($tenantId)->value('currency') ?: 'SAR');
        $currency = (string) ($input['currency'] ?? $tenantCurrency);
        if (! $replay && $currency !== $tenantCurrency) {
            $block('currency_mismatch', "Settlement currency {$currency} must equal the tenant currency {$tenantCurrency}.");
        }
        if (! $replay && ! $this->rollout->effectiveForCurrentTenant()->tenantEnabled) {
            $block('rollout_disabled', 'Online payments are not enabled for this tenant.');
        }

        if (! is_array($itemsInput) || $itemsInput === []) {
            $block('items_required', 'Gateway settlement requires at least one matched payment.');
        } elseif ($replay) {
            // تكرار آمن بالمبالغ والبنود نفسها أو تعارض؛ تُتجاوز أهلية البنود الجديدة كما في post().
            try {
                foreach ($itemsInput as $raw) {
                    $gross += $this->money($raw['gross_amount'] ?? null, 'item gross');
                }
                foreach ((is_array($refundsInput) ? $refundsInput : []) as $raw) {
                    $refundsTotal += $this->money($raw['amount_minor'] ?? null, 'refund amount');
                }
                if (! $this->replayMatches($existing, $net, $feeExTax, $feeTax, $deductions, $credits, $itemsInput, is_array($refundsInput) ? $refundsInput : [])) {
                    $block('reference_conflict', 'Provider settlement reference already posted with different amounts.');
                }
            } catch (DomainException $e) {
                $block('invalid_amount', $e->getMessage());
            }
        } elseif ($gateway !== null) {
            try {
                foreach ($this->normalizeItems($tenantId, (string) $gateway->id, $itemsInput, false) as $item) {
                    $gross += $item['gross_amount'];
                }
            } catch (DomainException $e) {
                $block('invalid_items', $e->getMessage());
            }
            if (! is_array($refundsInput)) {
                $block('invalid_refunds', 'Settlement refunds must be a list.');
            } else {
                try {
                    foreach ($this->normalizeRefunds($tenantId, (string) $gateway->id, $currency, $refundsInput, false, (string) ($input['settlement_date'] ?? now()->toDateString())) as $line) {
                        $refundsTotal += $line['amount'];
                    }
                } catch (DomainException $e) {
                    $block('invalid_refunds', $e->getMessage());
                }
            }
        }

        if ($feeTax > 0) {
            $block('fee_tax_not_authorized', 'Provider fee tax posting is not authorized until an approved input-tax routing policy exists.');
        }
        if ($deductions > 0) {
            $block('deductions_unsupported', 'Unsupported provider deductions cannot be posted.');
        }
        if ($credits > 0) {
            $block('credits_unsupported', 'Unsupported provider credits cannot be posted.');
        }

        $known = ! in_array(true, array_map(fn ($b) => in_array($b['code'], ['invalid_items', 'invalid_refunds', 'items_required', 'gateway_not_found', 'invalid_amount'], true), $blockers), true);
        $expectedNet = $gross - $refundsTotal - $feeExTax - $feeTax - $deductions + $credits;
        $difference = $known ? $expectedNet - $net : null;
        if ($known && $expectedNet < 0) {
            $block('negative_net_unsupported', 'Refunds and deductions exceed collections; the refund stays open until a later settlement covers it.');
        } elseif ($difference !== null && $gross > 0 && $difference !== 0 && ! $replay) {
            $block('unreconciled_difference', "Settlement does not reconcile: difference {$difference}.");
        }

        $reconciled = $difference !== null && $gross > 0 && $difference === 0;
        $codes = array_column($blockers, 'code');

        return [
            'gross' => $known ? $gross : null,
            'refunds_total' => $known ? $refundsTotal : null,
            'net_bank_amount' => $net,
            'provider_fee_ex_tax' => $feeExTax,
            'provider_fee_tax' => $feeTax,
            'provider_deductions' => $deductions,
            'provider_credits' => $credits,
            'difference' => $difference,
            'reconciled' => $reconciled,
            'postable' => $reconciled && $blockers === [],
            'saveable_as_unreconciled' => $known && $gross > 0 && $difference !== null && $difference !== 0 && $expectedNet >= 0 && array_diff($codes, ['unreconciled_difference']) === [],
            'replay' => $replay,
            'existing_status' => $existing?->status,
            'blockers' => $blockers,
        ];
    }

    /**
     * سندات القبض المرحَّلة عبر بوابة والتي بقي منها مبلغ غير مسوّى في 1170 (قراءة فقط، بلا أقفال).
     * الترشيح في SQL (مجموع البنود المرحَّلة بتسوية فرعية) مع ترقيم؛ يعيد `$limit + 1` صفاً كحدّ أقصى ليعرف المستدعي وجود المزيد.
     *
     * @return list<array{payment_id: string, number: ?string, date: ?string, amount: int, settled: int, remaining: int, partner_id: ?string}>
     */
    public function unsettledPayments(string $gatewayId, int $limit = 100, int $offset = 0): array
    {
        $this->requireTenant();
        $gateway = PaymentGateway::query()->whereKey($gatewayId)->first();
        if ($gateway === null) {
            throw new DomainException('Payment gateway must belong to the active tenant.');
        }

        $settledSql = '(SELECT COALESCE(SUM(i.gross_amount), 0) FROM payment_gateway_settlement_items i '
            .'JOIN payment_gateway_settlements s ON s.id = i.settlement_id '
            ."WHERE i.payment_id = payments.id AND s.status = 'posted')";

        $payments = Payment::query()
            ->select('payments.*')
            ->selectRaw("{$settledSql} AS settled_minor")
            ->where('payment_gateway_id', $gateway->id)
            ->where('direction', 'received')
            ->where('status', 'posted')
            ->whereRaw("payments.amount > {$settledSql}")
            ->orderBy('payment_date')->orderBy('id')
            ->offset(max(0, $offset))->limit(max(1, min(500, $limit)) + 1)
            ->get();

        return $payments->map(fn (Payment $payment) => [
            'payment_id' => (string) $payment->id,
            'number' => $payment->number,
            'date' => $payment->payment_date?->toDateString(),
            'amount' => (int) $payment->amount,
            'settled' => (int) $payment->settled_minor,
            'remaining' => (int) $payment->amount - (int) $payment->settled_minor,
            'partner_id' => $payment->partner_id,
        ])->all();
    }

    /**
     * استردادات البوابة المرحَّلة (A5) التي لم تُخصم كلياً من الصرف بعد (قراءة فقط، ترشيح SQL مع ترقيم).
     *
     * @return list<array{refund_id: string, number: ?string, amount: int, deducted: int, remaining: int, partner_id: ?string, currency: string, accounting_date: ?string}>
     */
    public function unsettledRefunds(string $gatewayId, int $limit = 100, int $offset = 0): array
    {
        $this->requireTenant();
        $gateway = PaymentGateway::query()->whereKey($gatewayId)->first();
        if ($gateway === null) {
            throw new DomainException('Payment gateway must belong to the active tenant.');
        }

        $deductedSql = '(SELECT COALESCE(SUM(l.amount_minor), 0) FROM payment_gateway_settlement_lines l '
            .'JOIN payment_gateway_settlements s ON s.id = l.settlement_id '
            ."WHERE l.payment_refund_id = payment_refunds.id AND s.status = 'posted')";

        $refunds = PaymentRefund::query()
            ->select('payment_refunds.*')
            ->selectRaw("{$deductedSql} AS deducted_minor")
            ->where('payment_gateway_id', $gateway->id)
            ->where('status', PaymentRefund::CONFIRMED)
            ->where('posting_status', PaymentRefund::POSTING_POSTED)
            ->whereRaw("payment_refunds.amount_minor > {$deductedSql}")
            ->orderBy('accounting_date')->orderBy('id')
            ->offset(max(0, $offset))->limit(max(1, min(500, $limit)) + 1)
            ->get();

        return $refunds->map(fn (PaymentRefund $r) => [
            'refund_id' => (string) $r->id,
            'number' => $r->number,
            'amount' => (int) $r->amount_minor,
            'deducted' => (int) $r->deducted_minor,
            'remaining' => (int) $r->amount_minor - (int) $r->deducted_minor,
            'partner_id' => $r->partner_id,
            'currency' => (string) $r->currency,
            'accounting_date' => $r->accounting_date?->toDateString(),
        ])->all();
    }

    private function assertUnsupportedAdjustmentsAreZero(int $deductions, int $credits): void
    {
        if ($deductions > 0) {
            throw new DomainException(
                'Unsupported provider deductions cannot be posted. PAY-V2-5 has no approved accounting role for non-fee gateway deductions; do not classify them as provider_fee_expense.'
            );
        }

        if ($credits > 0) {
            throw new DomainException(
                'Unsupported provider credits cannot be posted. PAY-V2-5 has no approved accounting role for gateway credits; do not classify them as provider_fee_expense.'
            );
        }
    }

    private function replayOrReject(
        PaymentGatewaySettlement $existing,
        int $net,
        int $feeExTax,
        int $feeTax,
        int $deductions,
        int $credits,
        array $itemsInput,
        array $refundsInput = [],
    ): PaymentGatewaySettlement {
        if (! $this->replayMatches($existing, $net, $feeExTax, $feeTax, $deductions, $credits, $itemsInput, $refundsInput)) {
            throw new DomainException('Provider settlement reference already posted with different amounts.');
        }

        return $existing->fresh(['items', 'lines', 'journalEntry.lines']);
    }

    /** نفس شرط التكرار الآمن لـ`post()`: المرجع نفسه بالمبالغ والبنود نفسها وتسوية مرحَّلة بقيد؛ تستعمله المعاينة فلا يتباعد الحكمان. */
    private function replayMatches(
        PaymentGatewaySettlement $existing,
        int $net,
        int $feeExTax,
        int $feeTax,
        int $deductions,
        int $credits,
        array $itemsInput,
        array $refundsInput = [],
    ): bool {
        $gross = 0;
        foreach ($itemsInput as $item) {
            $gross += $this->money($item['gross_amount'] ?? null, 'item gross');
        }
        $refunds = [];
        foreach ($refundsInput as $raw) {
            $refunds[strtolower((string) ($raw['payment_refund_id'] ?? ''))] = $this->money($raw['amount_minor'] ?? null, 'refund amount');
        }
        if (count($refunds) !== count($refundsInput)) {
            return false;   // مكرَّر في الحمولة ⇒ ليس تكراراً مطابقاً
        }
        $stored = $existing->lines()->where('line_type', PaymentGatewaySettlementLine::TYPE_REFUND)->pluck('amount_minor', 'payment_refund_id')
            ->map(fn ($v) => (int) $v)->all();
        ksort($refunds);
        ksort($stored);

        return $existing->isPosted()
            && (int) $existing->gross_amount === $gross
            && (int) $existing->net_bank_amount === $net
            && (int) $existing->provider_fee_ex_tax === $feeExTax
            && (int) $existing->provider_fee_tax === $feeTax
            && (int) $existing->provider_deductions === $deductions
            && (int) $existing->provider_credits === $credits
            && $stored === $refunds
            && (bool) $existing->journal_entry_id;
    }

    /**
     * بنود الاسترداد المخصومة من الصرف (A6): استرداد بوابة مؤكَّد ومرحَّل A5 لنفس البوابة والعملة، والمستهلَك تراكمياً ≤ مبلغه (يسمح بخصمه على دفعتين).
     *
     * @return list<array{refund_id: string, amount: int, provider_event_ref: ?string, number: ?string}>
     */
    private function normalizeRefunds(string $tenantId, string $gatewayId, string $currency, array $refundsInput, bool $lock = true, ?string $settlementDate = null): array
    {
        $normalized = [];
        $seen = [];
        $seenEvents = [];

        foreach ($refundsInput as $raw) {
            $refundId = strtolower((string) ($raw['payment_refund_id'] ?? ''));
            $amount = $this->money($raw['amount_minor'] ?? null, 'refund amount');
            $eventRef = isset($raw['provider_event_ref']) ? trim((string) $raw['provider_event_ref']) : '';
            $eventRef = $eventRef === '' ? null : $eventRef;

            if ($refundId === '') {
                throw new DomainException('Each settlement refund line requires a refund.');
            }
            if ($amount <= 0) {
                throw new DomainException('Settlement refund amount must be positive.');
            }
            if (isset($seen[$refundId])) {
                throw new DomainException('A refund cannot appear twice in the same settlement.');
            }
            $seen[$refundId] = true;

            if ($eventRef !== null) {
                if (isset($seenEvents[$eventRef])) {
                    throw new DomainException('Provider event references must be unique inside a settlement.');
                }
                $seenEvents[$eventRef] = true;
                $duplicate = PaymentGatewaySettlementLine::query()
                    ->where('provider_event_ref', $eventRef)
                    ->whereHas('settlement', fn ($q) => $q->where('payment_gateway_id', $gatewayId)->where('status', PaymentGatewaySettlement::STATUS_POSTED))
                    ->exists();
                if ($duplicate) {
                    throw new DomainException('Provider event reference already settled for this gateway.');
                }
            }

            $query = PaymentRefund::query()->whereKey($refundId);
            $refund = ($lock ? $query->lockForUpdate() : $query)->first();
            if ($refund === null) {
                throw new DomainException('Settlement refund must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $refund->tenant_id, 'Refund');
            if ((string) $refund->payment_gateway_id !== $gatewayId) {
                throw new DomainException('Settlement refund must reference the same gateway.');
            }
            if ($refund->status !== PaymentRefund::CONFIRMED || $refund->posting_status !== PaymentRefund::POSTING_POSTED || $refund->journal_entry_id === null) {
                throw new DomainException('refund_not_posted: only confirmed refunds already posted to the ledger can be deducted from a settlement.');
            }
            if ((string) $refund->currency !== $currency) {
                throw new DomainException('Settlement refund currency must match the settlement currency.');
            }

            // تسوية مؤرَّخة قبل ترحيل الاسترداد لا تخصمه (لا استهلاك لقيد لم يوجد بعد في تاريخها).
            if ($settlementDate !== null && $refund->accounting_date !== null && $settlementDate < $refund->accounting_date->toDateString()) {
                throw new DomainException('refund_after_settlement_date: the refund was posted after the settlement date.');
            }

            $consumed = (int) PaymentGatewaySettlementLine::query()
                ->where('payment_refund_id', $refund->id)
                ->whereHas('settlement', fn ($q) => $q->where('status', PaymentGatewaySettlement::STATUS_POSTED))
                ->sum('amount_minor');
            $remaining = (int) $refund->amount_minor - $consumed;
            if ($amount > $remaining) {
                throw new DomainException("Settlement refund {$amount} exceeds remaining undeducted amount {$remaining}.");
            }

            $normalized[] = ['refund_id' => (string) $refund->id, 'amount' => $amount, 'provider_event_ref' => $eventRef, 'number' => $refund->number];
        }

        return $normalized;
    }

    private function normalizeItems(string $tenantId, string $gatewayId, array $itemsInput, bool $lock = true): array
    {
        $normalized = [];
        $seenPayments = [];
        $seenEvents = [];

        foreach ($itemsInput as $raw) {
            $paymentId = strtolower((string) ($raw['payment_id'] ?? ''));
            $gross = $this->money($raw['gross_amount'] ?? null, 'item gross');
            $eventRef = isset($raw['provider_event_ref']) ? trim((string) $raw['provider_event_ref']) : '';
            $eventRef = $eventRef === '' ? null : $eventRef;

            if ($paymentId === '') {
                throw new DomainException('Each settlement item requires a payment.');
            }
            if (isset($seenPayments[$paymentId])) {
                throw new DomainException('A payment cannot appear twice in the same settlement.');
            }
            $seenPayments[$paymentId] = true;

            if ($eventRef !== null) {
                if (isset($seenEvents[$eventRef])) {
                    throw new DomainException('Provider event references must be unique inside a settlement.');
                }
                $seenEvents[$eventRef] = true;

                $duplicateEvent = PaymentGatewaySettlementItem::query()
                    ->where('provider_event_ref', $eventRef)
                    ->whereHas('settlement', function ($query) use ($gatewayId) {
                        $query->where('payment_gateway_id', $gatewayId)
                            ->where('status', PaymentGatewaySettlement::STATUS_POSTED);
                    })
                    ->exists();
                if ($duplicateEvent) {
                    throw new DomainException('Provider event reference already settled for this gateway.');
                }
            }

            $paymentQuery = Payment::query()->whereKey($paymentId);
            $payment = ($lock ? $paymentQuery->lockForUpdate() : $paymentQuery)->first();
            if ($payment === null) {
                throw new DomainException('Settlement payment must belong to the active tenant.');
            }
            $this->assertSameTenant($tenantId, (string) $payment->tenant_id, 'Payment');

            if (! $payment->isPosted()) {
                throw new DomainException('Only posted customer payments can be settled.');
            }
            if ($payment->direction !== 'received') {
                throw new DomainException('Gateway settlement matches customer collections only.');
            }
            if ((string) $payment->payment_gateway_id !== $gatewayId) {
                throw new DomainException('Settlement payment must reference the same gateway.');
            }

            $alreadySettled = (int) PaymentGatewaySettlementItem::query()
                ->where('payment_id', $payment->id)
                ->whereHas('settlement', fn ($query) => $query->where('status', PaymentGatewaySettlement::STATUS_POSTED))
                ->sum('gross_amount');

            $remaining = (int) $payment->amount - $alreadySettled;
            if ($gross > $remaining) {
                throw new DomainException("Settlement item {$gross} exceeds remaining uncleared amount {$remaining}.");
            }

            $normalized[] = [
                'payment_id' => $payment->id,
                'gross_amount' => $gross,
                'provider_event_ref' => $eventRef,
            ];
        }

        return $normalized;
    }

    /** @param  list<array{refund_id: string, amount: int, provider_event_ref: ?string, number: ?string}>  $refunds */
    private function settlementLines(
        string $bankAccountId,
        string $feeAccountId,
        string $clearingAccountId,
        int $net,
        int $feeExTax,
        int $gross,
        array $refunds = [],
    ): array {
        $lines = [];

        if ($net > 0) {
            $lines[] = ['account_id' => $bankAccountId, 'debit' => $net, 'description' => 'صافي تسوية البوابة'];
        }

        if ($feeExTax > 0) {
            $lines[] = ['account_id' => $feeAccountId, 'debit' => $feeExTax, 'description' => 'عمولة بوابة الدفع'];
        }

        // A6: الاسترداد المخصوم من الصرف سطر مدين مستقل على 1170 (يستهلك دائن A5) للتتبّع بالرقم.
        foreach ($refunds as $refund) {
            $lines[] = ['account_id' => $clearingAccountId, 'debit' => $refund['amount'], 'description' => 'استرداد مخصوم من الصرف '.($refund['number'] ?? '')];
        }

        $lines[] = ['account_id' => $clearingAccountId, 'credit' => $gross, 'description' => 'إقفال مقاصة البوابة'];

        return $lines;
    }

    /**
     * المعادلة الموسّعة: التحصيلات − الاستردادات = الصافي + الرسوم (+ ضريبتها) + الاستقطاعات − الاعتمادات.
     * يعيد الفرق الموقَّع (المتوقَّع − المُدخَل)؛ الصفر وحده يُرحَّل (D-21). الصافي السالب غير مدعوم (v1، ADR-0008 A6-4).
     */
    private function assertReconcilable(int $gross, int $refundsTotal, int $net, int $feeExTax, int $feeTax, int $deductions, int $credits, bool $allowUnreconciled): int
    {
        $expectedNet = $gross - $refundsTotal - $feeExTax - $feeTax - $deductions + $credits;
        if ($expectedNet < 0) {
            throw new DomainException(
                "negative_net_unsupported: refunds {$refundsTotal} + deductions exceed collections {$gross}; the refund stays open in gateway clearing until a later settlement covers it."
            );
        }
        $difference = $expectedNet - $net;
        if ($difference !== 0 && ! $allowUnreconciled) {
            throw new DomainException(
                "Gateway settlement does not reconcile: gross {$gross} != net {$net} + fee {$feeExTax} + fee_tax {$feeTax} + deductions {$deductions} - credits {$credits} + refunds {$refundsTotal}."
            );
        }
        if ($gross <= 0) {
            throw new DomainException('Gateway settlement gross must be positive.');
        }

        return $difference;
    }

    private function money(mixed $value, string $label): int
    {
        if ($value === null || $value === '') {
            throw new DomainException("Missing {$label}.");
        }
        if (is_float($value)) {
            throw new DomainException("{$label} must use integer minor units, not floating point.");
        }
        if (! is_int($value) && ! (is_string($value) && preg_match('/^-?\d+$/', $value))) {
            throw new DomainException("{$label} must use integer minor units.");
        }

        $amount = (int) $value;
        if ($amount < 0) {
            throw new DomainException("{$label} cannot be negative.");
        }

        return $amount;
    }

    private function requireTenant(): string
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new DomainException('Tenant context is required for gateway settlements.');
        }

        return $tenantId;
    }

    private function assertSameTenant(string $activeTenantId, string $recordTenantId, string $label): void
    {
        if ($recordTenantId !== $activeTenantId) {
            throw new DomainException("{$label} must belong to the active tenant.");
        }
    }
}

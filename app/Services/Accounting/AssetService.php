<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Asset;
use App\Models\Partner;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AssetService — الأصول الثابتة (اقتناء + إهلاك بالقسط الثابت)
 * ═══════════════════════════════════════════════════════════════
 *  - create():     ينشئ أصلاً draft ويشتقّ الضريبة/الإجمالي من التكلفة.
 *  - post():       يرحّل الاقتناء (يفعّل الأصل) ويولّد قيداً متوازناً.
 *  - depreciate(): يرحّل قسط إهلاك شهري (قسط ثابت) بقيد متوازن.
 *
 *  اقتناء معدّة 10000 + 15% نقداً:
 *    مدين 1210 المعدات        1000000
 *    مدين 1150 ضريبة المدخلات  150000
 *    دائن 1110 الصندوق        1150000
 *
 *  قسط إهلاك شهري = (التكلفة − التخريدية) ÷ العمر بالأشهر:
 *    مدين 5160 مصروف الإهلاك / دائن 1230 مجمع الإهلاك
 *
 *  لا كتابة مباشرة في journal_lines — المرور إجباري عبر المحرك.
 */
class AssetService
{
    private const ACC_CASH       = '1110';
    private const ACC_BANK       = '1120';
    private const ACC_PAYABLE    = '2110';
    private const ACC_INPUT_VAT  = '1150';
    private const ACC_ACCUM_DEP  = '1230';
    private const ACC_DEP_EXPENSE = '5160';

    public function __construct(protected LedgerService $ledger) {}

    /**
     * @param  array  $data  ['name'=>str, 'account_id'=>uuid, 'cost'=>int(هللات), 'tax_rate'=>?int,
     *                         'useful_life_months'=>?int, 'salvage_value'=>?int, 'payment_method'=>?,
     *                         'partner_id'=>?, 'acquisition_date'=>?, 'number'=>?, 'created_by'=>?]
     */
    public function create(array $data): Asset
    {
        $cost = (int) ($data['cost'] ?? 0);
        if ($cost <= 0) {
            throw new RuntimeException('تكلفة الأصل يجب أن تكون موجبة.');
        }

        $life = (int) ($data['useful_life_months'] ?? 60);
        if ($life <= 0) {
            throw new RuntimeException('العمر الإنتاجي يجب أن يكون موجباً.');
        }

        $salvage = (int) ($data['salvage_value'] ?? 0);
        if ($salvage < 0 || $salvage >= $cost) {
            throw new RuntimeException('القيمة التخريدية يجب أن تكون بين صفر وأقل من التكلفة.');
        }

        $this->assertFixedAssetAccount($data['account_id']);

        return DB::transaction(function () use ($data, $cost, $life, $salvage) {
            $date = $data['acquisition_date'] ?? now()->toDateString();
            $rate = (int) ($data['tax_rate'] ?? 15);
            $tax  = $this->calcTax($cost, $rate);

            return Asset::create([
                'number'             => $data['number'] ?? $this->nextNumber($date),
                'name'               => $data['name'],
                'account_id'         => $data['account_id'],
                'partner_id'         => $data['partner_id'] ?? null,
                'acquisition_date'   => $date,
                'payment_method'     => $data['payment_method'] ?? 'cash',
                'cost'               => $cost,
                'tax_rate'           => $rate,
                'tax_amount'         => $tax,
                'total'              => $cost + $tax,
                'salvage_value'      => $salvage,
                'useful_life_months' => $life,
                'status'             => 'draft',
                'created_by'         => $data['created_by'] ?? null,
            ]);
        });
    }

    /** ترحيل اقتناء الأصل: توليد قيد متوازن وتفعيل الأصل. */
    public function post(Asset $asset): Asset
    {
        if (! $asset->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل اقتناء أصل غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($asset) {
            $cost  = (int) $asset->cost;
            $tax   = $this->calcTax($cost, (int) $asset->tax_rate);
            $total = $cost + $tax;

            // مدين حساب الأصل + مدين ضريبة المدخلات / دائن نقد أو بنك أو موردون
            $lines = [['account_id' => $asset->account_id, 'debit' => $cost]];
            if ($tax > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_INPUT_VAT), 'debit' => $tax];
            }

            $creditLine = ['account_id' => $this->accountId($this->creditCode($asset->payment_method)), 'credit' => $total];
            if ($asset->payment_method === 'credit' && $asset->partner_id) {
                $creditLine['partner_type'] = Partner::class;
                $creditLine['partner_id']   = $asset->partner_id;
            }
            $lines[] = $creditLine;

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $asset->acquisition_date->toDateString(),
                'description' => "اقتناء أصل {$asset->number} — {$asset->name}",
                'source_type' => Asset::class,
                'source_id'   => $asset->id,
                'created_by'  => $asset->created_by,
            ]);

            $asset->update([
                'status'               => 'active',
                'tax_amount'           => $tax,
                'total'                => $total,
                'acquisition_entry_id' => $entry->id,
            ]);

            return $asset->fresh('account');
        });
    }

    /**
     * ترحيل قسط إهلاك شهري واحد (قسط ثابت). يتوقّف عند بلوغ الأساس القابل للإهلاك.
     */
    public function depreciate(Asset $asset, ?string $date = null): Asset
    {
        if (! $asset->isActive()) {
            throw new RuntimeException('لا يمكن إهلاك أصل غير مفعّل (active).');
        }

        $base      = $asset->depreciableBase();
        $remaining = $base - (int) $asset->accumulated_depreciation;
        if ($remaining <= 0) {
            throw new RuntimeException('الأصل مُهلَك بالكامل.');
        }

        // القسط الشهري الثابت، محدوداً بالمتبقّي (القسط الأخير قد يكون أصغر).
        $monthly = intdiv($base + (int) $asset->useful_life_months - 1, (int) $asset->useful_life_months); // تقريب لأعلى
        $amount  = min($monthly, $remaining);

        return DB::transaction(function () use ($asset, $amount, $date) {
            $entry = $this->ledger->post([
                ['account_id' => $this->accountId(self::ACC_DEP_EXPENSE), 'debit' => $amount],
                ['account_id' => $this->accountId(self::ACC_ACCUM_DEP), 'credit' => $amount],
            ], [
                'entry_date'  => $date ?? now()->toDateString(),
                'description' => "إهلاك أصل {$asset->number} — {$asset->name}",
                'source_type' => Asset::class,
                'source_id'   => $asset->id,
                'created_by'  => $asset->created_by,
            ]);

            $asset->update([
                'accumulated_depreciation' => (int) $asset->accumulated_depreciation + $amount,
            ]);

            return $asset->fresh('account');
        });
    }

    /** الحساب الدائن وفق طريقة الدفع. */
    private function creditCode(string $method): string
    {
        return match ($method) {
            'bank'   => self::ACC_BANK,
            'credit' => self::ACC_PAYABLE,
            default  => self::ACC_CASH,
        };
    }

    /** التأكد أن الحساب أصل ثابت فعلي يقبل القيود (12xx عدا مجمع الإهلاك). */
    protected function assertFixedAssetAccount(string $accountId): void
    {
        $account = Account::find($accountId);
        if (! $account) {
            throw new RuntimeException('حساب الأصل غير موجود في دليل الحسابات.');
        }
        if ($account->type !== 'asset' || $account->is_group) {
            throw new RuntimeException('الحساب المختار ليس حساب أصل قابلاً للقيد.');
        }
        if (! str_starts_with($account->code, '12') || $account->code === self::ACC_ACCUM_DEP) {
            throw new RuntimeException('يجب اختيار حساب أصل ثابت (12xx) غير مجمع الإهلاك.');
        }
    }

    /** حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float. */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /** توليد رقم تسلسلي: FA-2025-00001 */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = Asset::whereYear('acquisition_date', $year)->count() + 1;

        return sprintf('FA-%s-%05d', $year, $count);
    }
}

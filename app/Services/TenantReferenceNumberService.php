<?php

namespace App\Services;

use App\Models\Tenant;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * مصدر الحقيقة الوحيد لأرقام العميل القابلة للعرض.
 *
 * تُحجز القيم من صف عدّاد دائم ومقفول داخل معاملة التسجيل؛ لذلك لا تعتمد على
 * UUID أو عدد الصفوف، ولا تعيد استخدام رقم بعد soft/hard delete مستقبلي.
 */
class TenantReferenceNumberService
{
    public const ACCOUNT_DIGITS = 7;
    public const SUPPORT_MIN_DIGITS = 4;
    public const SUPPORT_MAX_DIGITS = 6;

    public function assign(Tenant $tenant): Tenant
    {
        return DB::transaction(function () use ($tenant): Tenant {
            $lockedTenant = Tenant::withTrashed()->whereKey($tenant->id)->lockForUpdate()->firstOrFail();

            if ($lockedTenant->account_number !== null && $lockedTenant->support_number !== null) {
                return $lockedTenant;
            }

            $sequence = DB::table('tenant_reference_number_sequences')
                ->where('id', 1)
                ->lockForUpdate()
                ->first();

            if ($sequence === null) {
                throw new LogicException('تعذر حجز عداد أرقام مرجع المستأجر.');
            }

            $assignAccountNumber = $lockedTenant->account_number === null;
            $assignSupportNumber = $lockedTenant->support_number === null;
            $accountNumber = $lockedTenant->account_number ?? (int) $sequence->next_account_number;
            $supportNumber = $lockedTenant->support_number ?? (int) $sequence->next_support_number;

            $this->assertWithinBounds($accountNumber, $supportNumber);

            $lockedTenant->forceFill([
                'account_number' => $accountNumber,
                'support_number' => $supportNumber,
            ])->save();

            DB::table('tenant_reference_number_sequences')
                ->where('id', 1)
                ->update([
                    'next_account_number' => $assignAccountNumber ? $accountNumber + 1 : $sequence->next_account_number,
                    'next_support_number' => $assignSupportNumber ? $supportNumber + 1 : $sequence->next_support_number,
                    'updated_at'          => now(),
                ]);

            return $lockedTenant->refresh();
        });
    }

    private function assertWithinBounds(int $accountNumber, int $supportNumber): void
    {
        if (strlen((string) $accountNumber) !== self::ACCOUNT_DIGITS) {
            throw new LogicException('نفد نطاق رقم حساب المستأجر ذي السبع خانات.');
        }

        $supportDigits = strlen((string) $supportNumber);

        if ($supportDigits < self::SUPPORT_MIN_DIGITS || $supportDigits > self::SUPPORT_MAX_DIGITS) {
            throw new LogicException('نفد نطاق رقم دعم المستأجر المسموح.');
        }
    }
}

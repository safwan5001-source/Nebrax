<?php

namespace App\Services\Commerce;

use App\Models\Storefront;
use App\Models\StorefrontBusinessProfile;
use App\Support\Commerce\BusinessVertical;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FLOWERS-H1 — إسناد ملف نشاط لمتجر.
 *
 * يكتب سطراً واحداً في `storefront_business_profiles` ولا يمسّ شيئاً آخر:
 * لا منتجات ولا أقسام ولا إعدادات قدرات ولا مظهر. تغيير الملف (أو الرجوع إلى
 * `general`) **لا يحذف بيانات التاجر** — الملف توصيةٌ تهيئة فقط.
 *
 * الملكية: المتجر يُحلّ عبر `Storefront::query()` (يخضع لـ`TenantScope`) ثم
 * يُعاد التحقق صراحةً من `tenant_id === TenantContext::id()`. مثاليّ التكرار:
 * إسناد القيمة نفسها لا يغيّر شيئاً.
 */
final class StorefrontBusinessProfileService
{
    public function assign(Storefront $storefront, BusinessVertical $vertical): StorefrontBusinessProfile
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        if ($storefront->tenant_id !== $tenantId) {
            throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
        }

        try {
            return $this->write($storefront, $vertical);
        } catch (QueryException $e) {
            // سباق على القيد الفريد (storefront_id): الفائز كتب الصفّ — نعيد
            // القراءة والتحديث مرة واحدة بدل الفشل.
            if (! $this->isUniqueViolation($e)) {
                throw $e;
            }

            return $this->write($storefront, $vertical);
        }
    }

    private function write(Storefront $storefront, BusinessVertical $vertical): StorefrontBusinessProfile
    {
        return DB::transaction(function () use ($storefront, $vertical) {
            $profile = StorefrontBusinessProfile::query()
                ->where('storefront_id', $storefront->id)
                ->lockForUpdate()
                ->first();

            if ($profile === null) {
                return StorefrontBusinessProfile::create([
                    'storefront_id' => $storefront->id,
                    'vertical' => $vertical->value,
                ]);
            }

            if ($profile->vertical !== $vertical->value) {
                $profile->forceFill(['vertical' => $vertical->value])->save();
            }

            return $profile;
        });
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = $e->errorInfo[0] ?? null;
        $driverCode = $e->errorInfo[1] ?? null;

        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }
}

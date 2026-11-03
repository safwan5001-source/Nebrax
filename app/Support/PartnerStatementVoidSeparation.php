<?php

namespace App\Support;

use App\Models\PartnerStatementReconciliation;
use App\Models\Tenant;
use App\Models\User;

/**
 * IMP-PS-A3e (D-PS-20، معتمد): سياسة فصل مهام الإبطال/الاستبدال لكل مستأجر. سياسة عمل لا صحّة تقنية (CLAUDE.md قاعدة 6) فهي إعداد في `tenants.settings.partner_statements.void_separation`
 * عبر آلية `Settings` القائمة (لا نظام إعدادات موازٍ):
 *  - `strict` (الافتراضي، وللمستأجرين القائمين الذين لم يحدّدوا): **لا يجوز لمن أغلق المقارنة أن يُبطلها أو يستبدلها** (ولا أن يستبدل بها أصلاً كان هو مُغلِقه).
 *  - `flexible`: يجوز للمُغلِق ذلك **إن امتلك** `partner_statements.void` (الصلاحية لا تُمنح تلقائياً).
 * أي قيمة أخرى/مفقودة/تالفة ⇒ `strict` (فشل مغلق). **لا مسار كتابة للمستخدمين في هذه الشريحة** (لا متحكّم ولا مسار)؛ واجهة الضبط وقناة آمنة مصرَّح بها لتغييره مؤجّلتان إلى PS-A4،
 * فلا يُفتح `flexible` لمستخدم قبلها. السياسة الفعّالة وقت العملية تُسجَّل في ملخّص حدث الإبطال/الاستبدال (`void_separation`)، **وتفرضها القاعدة** (مُشغّل يقرأ `tenants.settings` نفسه ويطابق
 * القيمة المسجَّلة ويرفض المُغلِق تحت `strict`) فلا يتجاوزها SQL خام ولا تُسجَّل سياسة غير الفعّالة.
 */
final class PartnerStatementVoidSeparation
{
    public const GROUP = 'partner_statements';

    public const KEY = 'void_separation';

    public const STRICT = 'strict';

    public const FLEXIBLE = 'flexible';

    public const VALUES = [self::STRICT, self::FLEXIBLE];

    /** السياسة الفعّالة للمستأجر الحالي (أو المُمرَّر): `flexible` فقط بقيمة مطابقة حرفياً، وإلا `strict`. */
    public static function effective(?Tenant $tenant = null): string
    {
        $value = $tenant === null ? Settings::get(self::GROUP, self::KEY) : Settings::group(self::GROUP, $tenant)[self::KEY] ?? null;

        return $value === self::FLEXIBLE ? self::FLEXIBLE : self::STRICT;
    }

    /** هل يمنع `$policy` هذا الفاعل من إخراج هذا النهائي (هو من أغلقه)؟ */
    public static function blocks(string $policy, User $actor, PartnerStatementReconciliation $final): bool
    {
        return $policy === self::STRICT && $final->closed_by !== null && (string) $final->closed_by === (string) $actor->getKey();
    }
}

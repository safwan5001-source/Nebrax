<?php

namespace App\Contracts;

/**
 * شيء يمكن دفعه إلكترونياً (فاتورة، طلب تجاري، أمر جهاز…). يملك المبلغ والعملة والطرف والصلاحية للدفع،
 * ولا يملك حالة المزوّد. المستهلكون (روابط الفواتير، المتجر، الجهاز) ينفّذونه في شرائحهم.
 */
interface Payable
{
    /** مفتاح ثابت "<type>:<id>" يحدّد الـ Payable داخل المستأجر (أحرف صغيرة/أرقام/_/-/. ثم ":" ثم المعرّف). */
    public function payableKey(): string;

    /** المتبقي المستحق بالهللات؛ يُعاد حسابه من المصدر عند كل محاولة، ولا يُخزَّن مسبقاً. */
    public function amountDueMinor(): int;

    public function currency(): string;

    /** null ⇒ لا ترحيل محاسبي لهذا الدفع (D-05). */
    public function partnerIdForAccounting(): ?string;

    /** @return list<array<string, mixed>> أهداف التخصيص المحاسبي (تُستهلك في شريحة الترحيل). */
    public function allocationTargets(): array;

    /** يرمي استثناء عمل إن لم يعد الدفع جائزاً (مسدَّد، ملغى، منتهٍ). */
    public function assertStillPayable(): void;
}

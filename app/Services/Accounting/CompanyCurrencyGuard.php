<?php

namespace App\Services\Accounting;

use App\Models\JournalEntry;
use App\Models\Tenant;
use App\Support\CompanyCurrencyLockedException;
use App\Support\Iso4217;

/**
 * CUR-1 — حماية عملة المؤسسة بعد وجود قيود مرحّلة.
 *
 * القاعدة: تغيير `tenants.currency` إلى قيمة **مختلفة** (بعد التطبيع) مرفوض ما دام للمؤسسة قيد `posted` أو `reversed`.
 * إعادة تسمية العملة بلا تحويل كانت تعيد وصف دفتر قائم دون تغيير أرقامه (D-12 / R1)؛ والتحويل بين العملات خارج النطاق.
 *
 * **سلامة التزامن (دون قفل جديد):** `resolve()` تُستدعى حصراً داخل معاملة تقفل صفّ المستأجر `FOR UPDATE` أولاً — هو
 * مِرساة المستأجر نفسها التي يقفلها كل ترحيل/عكس قيد (`LedgerService` ← `AccountingDateGuard::assertOpen` قبل إنشاء
 * القيد) وترقيم القيود والسنوات المالية وأقفال الفترات. فالترحيل المتزامن إما يلتزم قبل قفلنا فنراه، أو ينتظر التزامنا
 * فيرحّل بالعملة الجديدة (ولا قيود قبله أصلاً). ترتيب الأقفال: مِرساة المستأجر وحدها ثم قراءة بلا قفل ⇒ لا حلقة انتظار جديدة.
 * على SQLite يسقط `lockForUpdate` ويسلسل المحرّك أحادي الكاتب الكتابات.
 *
 * لا تكتب شيئاً ولا تحوّل قيماً ولا تعيد كتابة رمز تاريخي: الرمز المخزّن غير المطبَّع (مثل `sar` أو رمز قديم غير ISO)
 * يبقى كما هو ما دام الطلب لا يغيّره فعلاً.
 */
final class CompanyCurrencyGuard
{
    /**
     * يحسم أثر حقل `currency` المُرسَل على صفّ مقفول بالفعل.
     *
     * @param  mixed  $requested  القيمة المُرسَلة (غائبة/null/'' = لا تغيير مطلوب)
     * @return string|null الرمز المطبَّع الواجب كتابته، أو `null` إن لم يُطلب تغيير فعلي (لا كتابة للعمود)
     *
     * @throws CompanyCurrencyLockedException  تغيير فعلي بعد وجود قيد مرحّل
     */
    public function resolve(Tenant $lockedTenant, mixed $requested): ?string
    {
        $requested = Iso4217::normalize(is_string($requested) ? $requested : null);
        if ($requested === '') {
            return null;
        }

        // «نفس العملة» ولو اختلفت الأحرف أو كان المخزَّن غير مطبَّع: ليس تغييراً ولا كتابة (لا إعادة كتابة تاريخية).
        if ($requested === Iso4217::normalize((string) $lockedTenant->currency)) {
            return null;
        }

        if ($this->hasPostedEntries($lockedTenant)) {
            throw new CompanyCurrencyLockedException;
        }

        return $requested;
    }

    /** أي قيد `posted` أو `reversed` للمؤسسة (قراءة بلا قفل؛ نطاق المستأجر صريح فوق `TenantScope`). */
    public function hasPostedEntries(Tenant $tenant): bool
    {
        return JournalEntry::query()
            ->where('tenant_id', $tenant->getKey())
            ->whereIn('status', ['posted', 'reversed'])
            ->exists();
    }
}

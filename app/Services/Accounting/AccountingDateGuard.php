<?php

namespace App\Services\Accounting;

use App\Models\AccountingPeriodLock;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AccountingDateGuard — نقطة الإنفاذ المركزية لأقفال الفترات (ACC-6)
 * ═══════════════════════════════════════════════════════════════
 *  سؤالٌ واحد لا غير: **هل هذا التاريخ المحاسبي مفتوح لهذا المستأجر؟**
 *  لا يعرف الحارس شيئاً عن الفواتير ولا المخزون ولا توجيه الحسابات ولا إغلاق
 *  السنة المالية، ولا يغيّر حساباً ولا مبلغاً ولا اتجاهاً. يسمح أو يمنع.
 *
 *  ═══ لماذا داخل LedgerService لا في كل خدمة؟ ═══
 *  لأن كل أثر محاسبي في نبراس يمرّ حصراً بـ`post()`/`reverse()` (جردٌ موثَّق في
 *  تقرير ACC-6). فحارسٌ واحد هناك يغطّي الفوترة والمشتريات والمرتجعات والمخزون
 *  والرواتب والأصول والنقد والوقود ونقطة البيع وكل مستهلك مستقبلي، بلا استثناء
 *  ولا مفتاح تجاوز في أي خدمة.
 *
 *  ═══ التزامن — المِرساة ═══
 *  السباق المقصود: يقرأ الحارس «الفترة مفتوحة»، ثم يُنشَأ قفلٌ يشملها ويُثبَّت،
 *  ثم يُدرَج القيد — فيتسرّب قيدٌ داخل فترة صارت مقفلة.
 *
 *  يُغلق هذا بمِرساةٍ واحدة: **صفّ المستأجر** (`tenants`)، موجودٌ حتماً وقائمٌ
 *  فعلاً في المسار. `JournalEntry` مصنَّف `CompanyWide`، فترقيمه عبر
 *  `GeneratesDocumentNumbers::lockNumberingAnchor()` يقفل صفّ المستأجر أصلاً في
 *  كل `post()`/`reverse()`. الحارس يقفل **نفس الصفّ قبل قراءته** فيتقدّم اكتسابُ
 *  القفل بضع تعليمات داخل المعاملة نفسها — بلا تسلسلٍ إضافي وبلا انقلاب ترتيب.
 *  ومسار إنشاء/تحرير الأقفال (`AccountingPeriodLockService`) يقفل المِرساة ذاتها،
 *  فيتبادل المساران الاستبعاد على PostgreSQL. لا mutex في ذاكرة العملية.
 */
class AccountingDateGuard
{
    public function __construct(private TenantContext $tenantContext) {}

    /**
     * يرفض التاريخ إن وقع داخل نطاق قفلٍ نشط — **قبل** إنشاء أي قيد.
     *
     * @param  string  $context  وصفٌ قصير للعملية، يظهر في رسالة الرفض.
     */
    public function assertOpen(DateTimeInterface|string|null $date, string $context = 'الترحيل'): void
    {
        $accountingDate = $this->normalize($date);
        $lock = $this->activeLockFor($accountingDate);

        if ($lock === null) {
            return;
        }

        throw new AccountingPeriodLockedException(sprintf(
            '%s بتاريخ %s مرفوض: الفترة المحاسبية من %s إلى %s مقفلة.',
            $context,
            $accountingDate,
            $lock->start_date->toDateString(),
            $lock->end_date->toDateString(),
        ));
    }

    /** القفل النشط الذي يشمل التاريخ، أو `null` إن كان مفتوحاً. */
    public function activeLockFor(DateTimeInterface|string|null $date): ?AccountingPeriodLock
    {
        $tenantId = $this->tenantContext->id();

        // بلا مستأجر نشط لا يوجد قفلٌ يخصّه — ولا تُقرأ أقفال غيره: `TenantScope`
        // لا يصفّي حين لا سياق، فالتصفية هنا صريحة بالمعرّف لا اتّكالاً عليه.
        if ($tenantId === null) {
            return null;
        }

        $this->lockAnchor($tenantId);

        $accountingDate = $this->normalize($date);

        return AccountingPeriodLock::query()
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereDate('start_date', '<=', $accountingDate)
            ->whereDate('end_date', '>=', $accountingDate)
            ->first();
    }

    /**
     * تاريخ محاسبي `Y-m-d` بلا أي تحويل منطقة زمنية يزيح اليوم التقويمي.
     *
     * التاريخ الصريح يُقرأ كما كُتب (`2026-01-15` يبقى `2026-01-15`)، والغياب
     * يعني «اليوم» بنفس المصدر الذي يشتقّ منه `LedgerService` تاريخه الافتراضي
     * — فلا تدخل ACC-6 دلالةَ منطقةٍ زمنية جديدة.
     */
    private function normalize(DateTimeInterface|string|null $date): string
    {
        if ($date === null || $date === '') {
            return Carbon::now()->toDateString();
        }

        if ($date instanceof DateTimeInterface) {
            return $date->format('Y-m-d');
        }

        return Carbon::parse($date)->toDateString();
    }

    /**
     * قفل مِرساة المستأجر — نفس الصفّ الذي يقفله ترقيم القيود بعد قليل، فلا
     * تسلسلٌ إضافي. على SQLite يسقط `lockForUpdate` (لا أقفال صفوف فيه) ويبقى
     * محرّكه أحادي الكاتب هو الذي يسلسل الكتابات.
     */
    private function lockAnchor(string $tenantId): void
    {
        Tenant::whereKey($tenantId)->lockForUpdate()->first();
    }
}

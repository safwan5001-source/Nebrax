<?php

namespace App\Services\Accounting;

use App\Models\AccountingPeriodLock;
use App\Models\FiscalYear;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use DateTimeInterface;
use Illuminate\Support\Carbon;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AccountingDateGuard — نقطة الإنفاذ المركزية لأقفال الفترات (ACC-6)
 * ═══════════════════════════════════════════════════════════════
 *  سؤالٌ واحد لا غير: **هل هذا التاريخ المحاسبي مفتوح لهذا المستأجر؟**
 *  لا يعرف الحارس شيئاً عن الفواتير ولا المخزون ولا توجيه الحسابات، ولا يغيّر
 *  حساباً ولا مبلغاً ولا اتجاهاً ولا تاريخاً. يسمح أو يمنع.
 *
 *  ═══ «مفتوح» = لا قفل فترة نشط **ولا سنة مالية مقفلة** تشمله ═══
 *  ACC-6: قفل فترة نشط (`AccountingPeriodLock`) يمنع — سلطةٌ مستقلّة بصلاحيتها وسجلّها.
 *  FC-3 (يحلّ محلّ قول FISCAL-2 «سلطتان مستقلّتان» في جانب الترحيل): سنةٌ مالية حالتها
 *  `closed` تمنع أيضاً كل ترحيل/عكس تاريخه داخل حدّيها الشاملين. **إلزاميّ بلا إعداد
 *  مستأجر ولا مفتاح تجاوز**: التصحيح بفتح السنة رسمياً (صلاحية `fiscal_years.reopen`
 *  وسبب مسجَّل وجيل جديد) لا بقيدٍ صامت يغيّر نتيجتها. قفل الفترة باقٍ كما هو: لا يحلّ
 *  محلّ الإقفال ولا الإقفال محلّه، وتحريرُه لا يفتح سنةً مقفلة.
 *  قيد الإقفال نفسه وعكسه عند الفتح يمرّان لأن السنة داخل معاملتهما `closing`/`reopening`
 *  لا `closed` — حالتان لا تُثبَّتان أبداً (المعاملة واحدة)، فلا يراهما غير معاملتهما.
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

        if ($lock !== null) {
            throw new AccountingPeriodLockedException(sprintf(
                '%s بتاريخ %s مرفوض: الفترة المحاسبية من %s إلى %s مقفلة.',
                $context,
                $accountingDate,
                $lock->start_date->toDateString(),
                $lock->end_date->toDateString(),
            ));
        }

        // FC-3 — بعد قفل المِرساة (داخل `activeLockFor`) وقبل أي كتابة: قراءةٌ عادية بلا قفلٍ
        // جديد، فلا يتغيّر ترتيب الأقفال. الإقفال والفتح يقفلان المِرساة نفسها أولاً، فإن سبق
        // أحدُهما انتظره الترحيل ثم رأى حالته **المثبَّتة**؛ وإن سبق الترحيل انتظره الإقفال فأدخل
        // قيده في حسابه (إعادة الفحص داخل معاملة الإقفال).
        $year = $this->closedFiscalYearFor($accountingDate);
        if ($year !== null) {
            throw new FiscalYearClosedException(sprintf(
                '%s بتاريخ %s مرفوض: السنة المالية «%s» (%s إلى %s) مقفلة. '
                . 'لتصحيحها افتح السنة المالية رسمياً بصلاحية الفتح وسببٍ مسجَّل، أو أرّخ العملية في فترة مفتوحة.',
                $context,
                $accountingDate,
                $year->name,
                $year->start_date->toDateString(),
                $year->end_date->toDateString(),
            ));
        }
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
     * السنة المالية **المقفلة** (`closed`) التي تشمل التاريخ، أو `null`. حدّا السنة شاملان، والتصفية
     * بالمستأجر صريحة كما في أقفال الفترات. `closing`/`reopening` لا تُعدّان مقفلتين: لا تُرى إلا داخل
     * معاملة الإقفال/الفتح نفسها، التي تُرحِّل قيد الإقفال أو عكسه.
     */
    private function closedFiscalYearFor(string $accountingDate): ?FiscalYear
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            return null;
        }

        return FiscalYear::query()
            ->where('tenant_id', $tenantId)
            ->where('status', FiscalYear::STATUS_CLOSED)
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

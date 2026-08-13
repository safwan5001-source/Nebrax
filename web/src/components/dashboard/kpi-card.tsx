'use client';

import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Sparkline } from '@/components/charts/sparkline';
import { cn } from '@/lib/utils';

/**
 * بطاقة مؤشّر — بسطر فرعي اختياري تحت خطّ منقّط.
 *
 * السطر الفرعي هو ما يجعل بطاقة «الأداء المالي» مدمجة عمداً: الرقم الرئيسي
 * إجمالي المبيعات، وتحته صافي الدخل بعد المصروفات. جمعُهما في بطاقة واحدة
 * يمنع قراءة المبيعات وحدها على أنها ربح — وهو أكثر سوء فهم شيوعاً في لوحات
 * التحكم المحاسبية.
 */
export function KpiCard({
  label,
  value,
  unit,
  icon: Icon,
  tone = 'primary',
  trend,
  trendLabel,
  sub,
  loading,
}: {
  label: string;
  value: string;
  /** «ريال» — يُعرض بحجم أصغر بجانب الرقم لا داخله. */
  unit?: string;
  icon: LucideIcon;
  tone?: 'primary' | 'positive';
  trend?: number[];
  trendLabel?: string;
  /** السطر الفرعي: عنوان + قيمة، تحت خطّ منقّط. */
  sub?: { label: string; value: string; tone?: 'positive' | 'negative' | 'muted' };
  loading?: boolean;
}) {
  // ═══════════════════════════════════════════════════════════════
  //  الأيقونة `muted` دائماً — لا صندوق ولا لون دلالي
  // ═══════════════════════════════════════════════════════════════
  //  `DESIGN_SYSTEM.md` قاعدتان: «لا أيقونات في صناديق ملوّنة»، و«الأخضر
  //  والأحمر دلاليان حصراً **للأرقام والحالات المالية**». أيقونة البطاقة ليست
  //  رقماً ولا حالة — فتلوينها زخرفة. الدلالة تبقى حيث تنتمي: الرقم والشرارة.
  //
  //  و`tone` لم يُحذف: ما زال يحكم لون الشرارة (بيانات مالية).
  const subColor =
    sub?.tone === 'negative' ? 'text-negative' : sub?.tone === 'muted' ? 'text-muted' : 'text-positive';

  // `DESIGN_SYSTEM.md` — «الأرقام المالية: السالب أحمر مع إشارة لا لوناً وحده».
  // الإشارة يضعها المنسّق (`-3,321`)، واللون هنا. رقمٌ سالب بلون النصّ العادي
  // يمرّ دون أن يُلاحَظ — وقد ظهر ذلك فعلاً في «قيمة المخزون» بالإنتاج.
  const isNegativeValue = value.trim().startsWith('-');

  return (
    /**
     * ═══════════════════════════════════════════════════════════════
     *  ارتفاع موحّد في الصفّ
     * ═══════════════════════════════════════════════════════════════
     *  شبكة CSS تمطّ **عنصر الشبكة** لا البطاقة داخله؛ فبطاقةٌ بلا `h-full`
     *  تنكمش إلى محتواها، وتبدو البطاقة ذات السطر الفرعي أطول من جاراتها
     *  فينكسر الصفّ. `h-full` + عمود مرن يجعل الارتفاع واحداً، و`mt-auto`
     *  يدفع السطر الفرعي إلى القاع بدل أن يطفو في المنتصف.
     */
    <Card className="h-full rounded-2xl">
      {/* حشوٌ وخطٌّ أصغر على الجوال: أربع بطاقات في شبكة ٢×٢ تأكل الشاشة قبل
          أن يصل المستخدم إلى الرسم البياني. الديسكتوب يبقى على مقاسه — عنده
          المساحة، والرقم الأكبر أسهل قراءةً من بُعد. */}
      <CardContent className="flex h-full flex-col p-3.5 sm:p-[18px]">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-muted sm:text-[13px]">{label}</span>
          <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
        </div>

        {loading ? (
          <Skeleton className="mt-2 h-6 w-28 sm:mt-3 sm:h-7 sm:w-32" />
        ) : (
          <div className="mt-1.5 flex items-baseline gap-1.5 sm:mt-2.5">
            <span
              className={cn(
                'num text-[21px] font-bold leading-tight sm:text-[26px]',
                isNegativeValue ? 'text-negative' : 'text-text'
              )}
            >
              {value}
            </span>
            {unit && <span className="text-[13px] font-medium text-muted">{unit}</span>}
          </div>
        )}

        {trend && !loading && (
          <div className="mt-1.5 flex justify-end pb-2 sm:mt-2 sm:pb-2.5">
            <Sparkline
              data={trend}
              color={tone === 'positive' ? 'var(--positive)' : 'var(--primary)'}
              label={trendLabel ?? label}
            />
          </div>
        )}

        {sub && !loading && (
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-dashed border-border pt-2 sm:pt-2.5">
            <span className="text-[11px] leading-snug text-muted">{sub.label}</span>
            {/* ═══════════════════════════════════════════════════════════
                إشارة + لون، لا لون وحده
                ═══════════════════════════════════════════════════════════
                `DESIGN_SYSTEM.md` يفرض ألّا يحمل اللونُ الدلالةَ منفرداً — من لا
                يميّز الأحمر من الأخضر لا يقرأ الإشارة، والطباعة بالأبيض والأسود
                تُلغي اللون أصلاً. فالسهم يقول ما يقوله اللون. */}
            <span className={cn('num flex shrink-0 items-center gap-0.5 text-[13px] font-bold', subColor)}>
              {sub.tone === 'negative' ? (
                <ArrowDownRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
              ) : sub.tone === 'muted' ? null : (
                <ArrowUpRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} aria-hidden />
              )}
              {sub.value}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

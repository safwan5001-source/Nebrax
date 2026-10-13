'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Clock, Minus, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type {
  DeliveryLadder,
  DownstreamStatus,
  ManualAttributionStatus,
  NativeStatus,
} from '@/lib/integration-center';

/**
 * سُلّم القدرات الأربع (A/B/C/D) — عرض فقط، INT-UX-2.
 *
 * أربع حقائق مستقلة تُعرض دائماً بالترتيب نفسه وكلها حاضرة (الناقص يُذكر ولا يُخفى)، كل منها
 * بأيقونة + نص (اللون ثانوي). لا يظهر هنا أي زر أو رابط أو حقل: السُلّم وصفٌ للحالة لا
 * مدخلٌ لإجراء. ولا تُستعمل «متصل/مزامنة نشطة» إلا لو وُجد مصدر بيانات لهما، ولا مصدر لهما اليوم.
 */

type Tone = 'neutral' | 'muted' | 'warning';

const MANUAL: Record<ManualAttributionStatus, { tone: Tone; icon: LucideIcon }> = {
  set: { tone: 'neutral', icon: Check },
  unset: { tone: 'muted', icon: Minus },
  disabled: { tone: 'muted', icon: Minus },
  unreadable: { tone: 'warning', icon: AlertTriangle },
};

const NATIVE: Record<NativeStatus, { tone: Tone; icon: LucideIcon }> = {
  available: { tone: 'neutral', icon: Check },
  pending: { tone: 'muted', icon: Clock },
  unavailable: { tone: 'muted', icon: Minus },
  unreadable: { tone: 'warning', icon: AlertTriangle },
};

const DOWNSTREAM: Record<DownstreamStatus, { tone: Tone; icon: LucideIcon }> = {
  blocked: { tone: 'muted', icon: Minus },
  no_data: { tone: 'muted', icon: Minus },
  unreadable: { tone: 'warning', icon: AlertTriangle },
};

export type LadderStep = 'a' | 'b' | 'c' | 'd';
export const LADDER_STEPS: readonly LadderStep[] = ['a', 'b', 'c', 'd'];

export function useLadderText() {
  const t = useTranslations('integrationCenter');

  const label = (step: LadderStep) => t(`ladder.${step}.label`);

  function value(step: LadderStep, ladder: DeliveryLadder): string {
    if (step === 'a') return t(`ladder.a.${ladder.a}`);
    if (step === 'b') return t(`ladder.b.${ladder.b}`);
    const status = step === 'c' ? ladder.c : ladder.d;
    return t(`ladder.downstream.${status === 'no_data' ? 'noData' : status}`);
  }

  function description(step: LadderStep, ladder: DeliveryLadder): string {
    if (step === 'a') return t(`ladder.a.desc_${ladder.a}`);
    if (step === 'b') return t(`ladder.b.desc_${ladder.b}`);
    return t(`ladder.${step}.desc`);
  }

  return { label, value, description };
}

function chipFor(step: LadderStep, ladder: DeliveryLadder): { tone: Tone; icon: LucideIcon } {
  if (step === 'a') return MANUAL[ladder.a];
  if (step === 'b') return NATIVE[ladder.b];
  return DOWNSTREAM[step === 'c' ? ladder.c : ladder.d];
}

/** قيمة خطوة واحدة: أيقونة + نص داخل شارة. تُستعمل في الجدول والبطاقات والتفاصيل. */
export function LadderValue({ step, ladder }: { step: LadderStep; ladder: DeliveryLadder }) {
  const text = useLadderText();
  const { tone, icon: Icon } = chipFor(step, ladder);

  return (
    <Badge tone={tone} data-ladder-step={step} className="whitespace-normal text-start">
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {text.value(step, ladder)}
    </Badge>
  );
}

/** السُلّم الكامل لصفحة تفاصيل المنصة: كل صف = اسم الخطوة + قيمتها + سطر يشرح معناها. */
export function CapabilityLadder({ ladder }: { ladder: DeliveryLadder }) {
  const text = useLadderText();

  return (
    <dl className="divide-y divide-border rounded-md border border-border bg-surface" data-testid="capability-ladder">
      {LADDER_STEPS.map((step) => (
        <div key={step} className="grid gap-1.5 p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4" data-ladder-row={step}>
          <dt className="text-sm font-medium text-text">{text.label(step)}</dt>
          <dd className="min-w-0 space-y-1">
            <LadderValue step={step} ladder={ladder} />
            <p className="text-sm leading-relaxed text-muted">{text.description(step, ladder)}</p>
          </dd>
        </div>
      ))}
    </dl>
  );
}

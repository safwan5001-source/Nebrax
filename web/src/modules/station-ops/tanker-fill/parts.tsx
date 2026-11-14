'use client';

import { useId, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CircleAlert, Info, RefreshCw, TriangleAlert, WifiOff, type LucideIcon } from 'lucide-react';
import { Badge } from '../admin/ui';
import { formatLitersNumberFromMl, formatStampInZone } from '../format';
import { OPS_BASE } from '../nav';
import type { FillWriteResult } from './client';
import { REJECTION_STEP, isKnownReason, SHIFT_REASONS, type Step } from './logic';
import type { TankerFill } from './schemas';

export const TANKER_BASE = `${OPS_BASE}/tanker-fills`;

/** حالة السند: **التسجيل لا يخصم المخزون** — يبقى «بانتظار الدمج المخزني» حتى ترحيل مخوَّل. الملغى حالة مستقلة. */
export function FillStatusBadge({ fill }: { fill: Pick<TankerFill, 'status' | 'inventory_status'> }) {
  const t = useTranslations('stationOps');
  if (fill.status === 'voided') return <Badge tone="negative">{t('tankerFill.status.voided')}</Badge>;
  const tone = fill.inventory_status === 'posted' ? 'positive' : fill.inventory_status === 'reversed' ? 'neutral' : 'warning';
  const known = fill.inventory_status === 'pending_integration' || fill.inventory_status === 'posted' || fill.inventory_status === 'reversed';
  return <Badge tone={tone}>{known ? t(`tankerFill.status.${fill.inventory_status}`) : t('tankerFill.status.other')}</Badge>;
}

/** تنبيه ثابت: تسجيل السند وحده لا يغيّر مخزون المحطة. نص موظف — بلا مصطلحات مالية أو محاسبية. */
export function NoStockNote() {
  const t = useTranslations('stationOps');
  return (
    <p data-no-stock-note="" className="flex items-start gap-2 rounded-[12px] bg-primary-soft p-3 text-sm leading-6 text-text">
      <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.9} />
      <span>{t('tankerFill.noStockNote')}</span>
    </p>
  );
}

export function Liters({ ml }: { ml: number }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return <span className="num" dir="ltr">{formatLitersNumberFromMl(ml, locale)} <span className="text-xs text-muted">{t('tankerFill.liters')}</span></span>;
}

export function When({ value, timeZone }: { value: string | null; timeZone?: string | null }) {
  const locale = useLocale();
  return <span className="num">{formatStampInZone(value, locale, timeZone)}</span>;
}

/** حقل نص كبير (≥16px لمنع تكبير iOS) بالنمط نفسه لحقل الأرقام؛ `dir="ltr"` للأرقام والرموز. */
export function TextField({ label, value, onChange, hint, error, maxLength, inputMode = 'text', placeholder, testId, type = 'text', dir = 'ltr' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: ReactNode;
  error?: string | null;
  maxLength?: number;
  inputMode?: 'text' | 'numeric' | 'search';
  placeholder?: string;
  testId?: string;
  type?: 'text' | 'search';
  dir?: 'ltr' | 'rtl' | 'auto';
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-text">{label}</label>
      <input
        id={id}
        data-testid={testId}
        type={type}
        inputMode={inputMode}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        dir={dir}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value)}
        className={`mt-1.5 h-14 w-full min-w-0 rounded-[11px] border ${error ? 'border-negative' : 'border-[color:var(--fo-control)]'} bg-surface px-3 text-start text-lg font-semibold text-text placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
      />
      {hint ? <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 flex items-start gap-1.5 text-sm leading-5 text-negative">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

/** بطاقة اختيار (راديو بصري) بهدف لمس ≥ 56px: النص هو الحالة — اللون وحده لا يكفي. */
export function ChoiceCard({ selected, disabled = false, onSelect, title, hint, reason, testId }: {
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
  title: ReactNode;
  hint?: ReactNode;
  reason?: string | null;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      data-testid={testId}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      className={`flex min-h-14 w-full items-center gap-3 rounded-[13px] border p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
        selected ? 'border-primary bg-primary-soft' : 'border-[color:var(--fo-control)] bg-surface'
      } ${disabled ? 'opacity-60' : 'hover:bg-primary-soft'}`}
    >
      <span aria-hidden="true" className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selected ? 'border-primary' : 'border-[color:var(--fo-control)]'}`}>
        {selected ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-text">{title}</span>
        {hint ? <span className="mt-0.5 block text-sm leading-5 text-muted">{hint}</span> : null}
        {reason ? <span className="mt-0.5 block text-sm leading-5 text-warning">{reason}</span> : null}
      </span>
    </button>
  );
}

// ───────────────────────── نتائج الكتابة ─────────────────────────

export interface FillFailure {
  tone: 'error' | 'warning';
  messageKey: string;
  serverMessage: string | null;
  /** يفيد «تحقق من الحالة» (قراءة): النتيجة غير مؤكدة أو الوردية تغيّرت. */
  canCheck: boolean;
  /** الخطوة التي يعود إليها الموظف لتصحيح الرفض. */
  step: Step | null;
  shiftChanged: boolean;
}

/** يترجم نتيجة غير ناجحة إلى رسالة موظف (دالة نقية). نص الخادم الأصلي يظهر فقط للرفض غير المصنَّف أو تكرار السند (يحمل تفصيلاً مفيداً). */
export function describeFillFailure(result: FillWriteResult): FillFailure | null {
  switch (result.kind) {
    case 'ok':
      return null;
    case 'rejected': {
      const code = result.code;
      const known = isKnownReason(code);
      return {
        tone: 'error',
        messageKey: `tankerFill.reject.${code}`,
        serverMessage: code === 'validation' || code === 'voucher_duplicate' ? result.serverMessage : null,
        canCheck: false,
        step: known ? (REJECTION_STEP[code] ?? null) : null,
        shiftChanged: known && SHIFT_REASONS.includes(code),
      };
    }
    case 'unknown':
      return { tone: 'warning', messageKey: `tankerFill.unknown.${result.reason}`, serverMessage: null, canCheck: true, step: null, shiftChanged: false };
    case 'unverified':
      return { tone: 'warning', messageKey: 'tankerFill.unverified', serverMessage: null, canCheck: true, step: null, shiftChanged: false };
    case 'not_sent':
      return { tone: 'warning', messageKey: `tankerFill.notSent.${result.reason}`, serverMessage: null, canCheck: false, step: null, shiftChanged: false };
  }
}

/** نتيجة تعني أن السند قد يكون سُجِّل فعلاً (لا يجوز إعلان فشل نهائي ولا بدء سند جديد قبل حسمها). */
export function mayHaveApplied(result: FillWriteResult): boolean {
  return result.kind === 'unknown' || result.kind === 'unverified';
}

/** هل يُمسح مفتاح النية بعد هذه النتيجة؟ رفض نهائي أو «لم يُرسل» **ولم تسبقه محاولة غير مؤكدة** فقط (محاولة سابقة قد تكون التزمت ⇒ يبقى المفتاح). */
export function shouldClearKey(result: FillWriteResult, priorUncertain: boolean): boolean {
  return (result.kind === 'rejected' || result.kind === 'not_sent') && !priorUncertain;
}

export function FillNotice({ failure, onCheck, checking = false, children }: { failure: FillFailure | null; onCheck?: () => void; checking?: boolean; children?: ReactNode }) {
  const t = useTranslations('stationOps');
  if (!failure) return null;
  const Icon: LucideIcon = failure.messageKey.startsWith('tankerFill.notSent') ? WifiOff : failure.tone === 'error' ? CircleAlert : TriangleAlert;
  const tone = failure.tone === 'error' ? 'bg-[color:var(--fo-negative-tint)] text-negative' : 'bg-[color:var(--fo-warning-tint)] text-warning';
  return (
    <div role="alert" data-fill-notice={failure.tone} data-notice-key={failure.messageKey} className={`flex items-start gap-3 rounded-[14px] border border-border p-3.5 text-sm leading-6 ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p>{t(failure.messageKey)}</p>
        {failure.serverMessage ? <p className="mt-1 break-words text-xs opacity-90">{t('tankerFill.serverSays', { message: failure.serverMessage })}</p> : null}
        {failure.canCheck && onCheck ? (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            data-check-status=""
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-current bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            {checking ? t('write.checking') : t('write.check')}
          </button>
        ) : null}
        {children}
      </div>
    </div>
  );
}

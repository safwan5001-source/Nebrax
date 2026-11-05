'use client';

import { useId, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { TriangleAlert, WifiOff, CircleAlert, RefreshCw, type LucideIcon } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { describeFailure } from './write-outcome';
import type { WriteResult } from './write-client';

/** مكوّنات مشتركة لشاشات الكتابة (UI-2): إشعار نتيجة، حقل رقمي كبير، حوار تأكيد، أزرار بهدف لمس ≥ 48px. خصائص منطقية فقط (RTL/LTR). */

export function WriteNotice({ result, onCheck, checking = false }: { result: WriteResult | null; onCheck?: () => void; checking?: boolean }) {
  const t = useTranslations('stationOps');
  const failure = result ? describeFailure(result) : null;
  if (!failure) return null;
  const Icon: LucideIcon = result?.kind === 'not_sent' ? WifiOff : failure.tone === 'error' ? CircleAlert : TriangleAlert;
  const tone = failure.tone === 'error' ? 'bg-[color:var(--fo-negative-tint)] text-negative' : 'bg-[color:var(--fo-warning-tint)] text-warning';
  return (
    <div role="alert" data-write-notice={failure.tone} className={`flex items-start gap-3 rounded-[14px] border border-border p-3.5 text-sm leading-6 ${tone}`}>
      <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.9} />
      <div className="min-w-0 flex-1">
        <p>{t(failure.messageKey)}</p>
        {failure.serverMessage ? <p className="mt-1 break-words text-xs opacity-90">{t('write.serverSays', { message: failure.serverMessage })}</p> : null}
        {failure.canCheck && onCheck ? (
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-current bg-surface px-3 text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} strokeWidth={1.8} />
            {checking ? t('write.checking') : t('write.check')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

const BASE = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] px-4 text-[15px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50';

export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" data-primary-action="" {...props} className={`${BASE} bg-[color:var(--fo-cta-bg)] text-[color:var(--fo-cta-fg)]`}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  return (
    <button type="button" {...props} className={`${BASE} border border-[color:var(--fo-control)] bg-surface text-text hover:bg-primary-soft`}>
      {children}
    </button>
  );
}

/**
 * حقل رقمي كبير (≥16px لمنع تكبير iOS، ارتفاع 56px). `dir="ltr"` والأرقام 0–9 دائماً؛ المحتوى الخام يعود للمستدعي (التحليل في `entry.ts`).
 * الحالة (خطأ/تنبيه/محفوظ) نص + أيقونة لا لوناً وحده، وتُربط بالحقل عبر `aria-describedby`.
 */
export function NumberField({ label, ariaLabel, value, onChange, suffix, hint, error, warning, disabled = false, readOnly = false, inputRef, onEnter, testId, placeholder = '0' }: {
  label: string;
  /** الاسم الكامل لقارئ الشاشة (يحوي نص التسمية المرئية — WCAG 2.5.3) حين تكون التسمية المرئية مختصرة لأن الصف نفسه يحمل الاسم. */
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  suffix?: string;
  hint?: ReactNode;
  error?: string | null;
  warning?: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  inputRef?: (element: HTMLInputElement | null) => void;
  onEnter?: () => void;
  testId?: string;
  placeholder?: string;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null, warning ? `${id}-warn` : null].filter(Boolean).join(' ') || undefined;
  const border = error ? 'border-negative' : warning ? 'border-warning' : 'border-[color:var(--fo-control)]';
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="block text-sm font-medium text-text">{label}</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id={id}
          ref={inputRef}
          data-entry-input=""
          data-testid={testId}
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          dir="ltr"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && onEnter) {
              event.preventDefault();
              onEnter();
            }
          }}
          className={`num h-14 min-w-0 flex-1 rounded-[11px] border ${border} bg-surface px-3 text-start text-xl font-semibold text-text placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60`}
        />
        {suffix ? <span className="shrink-0 text-sm text-muted">{suffix}</span> : null}
      </div>
      {hint ? <p id={`${id}-hint`} className="mt-1 text-xs leading-5 text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${id}-err`} role="alert" className="mt-1 flex items-start gap-1.5 text-sm leading-5 text-negative">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>{error}</span>
        </p>
      ) : null}
      {warning ? (
        <p id={`${id}-warn`} className="mt-1 flex items-start gap-1.5 text-sm leading-5 text-warning">
          <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.9} />
          <span>{warning}</span>
        </p>
      ) : null}
    </div>
  );
}

/** حوار تأكيد: يستعمل `Dialog` المشترك (حبس تركيز، Escape، إعادة التركيز) بلا زر إغلاق صغير — الإغلاق بزر «رجوع» كبير. */
export function ConfirmDialog({ open, title, onClose, busy = false, children }: { open: boolean; title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  return (
    <Dialog open={open} onClose={() => { if (!busy) onClose(); }} title={title} hideClose className="max-w-md">
      {children}
    </Dialog>
  );
}

/** شريط إجراء لاصق أعلى التنقل السفلي (يبقى ظاهراً أثناء التمرير دون `fixed` الذي تُربكه لوحة مفاتيح iOS). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div data-action-bar="" className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-surface px-4 py-3 [box-shadow:var(--fo-shadow)] md:bottom-0">
      {children}
    </div>
  );
}

export function SectionCard({ title, children, id }: { title?: string; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-[14px] border border-border bg-surface p-4">
      {title ? <h2 id={id} className="mb-3 text-base font-semibold text-text">{title}</h2> : null}
      {children}
    </section>
  );
}

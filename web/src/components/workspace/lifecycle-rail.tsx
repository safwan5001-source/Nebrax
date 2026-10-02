'use client';

import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LifecycleDefinition } from './lifecycle';

/**
 * Lifecycle Rail — two independent axes (document · payment), stored states only.
 *
 * - Document axis: the stored sequence; completed steps carry a check, the current step
 *   is marked with Apex + weight + `aria-current="step"`. A terminal state (cancelled)
 *   replaces the path.
 * - Payment axis: shown only when the document is posted AND the domain owns a
 *   `payment_status`. It is never derived here — it is the value the server returned.
 * - Muted steps use text-secondary, not tertiary: the command bar sits on the Desk surface, where
 *   tertiary measures 4.25:1 (< 4.5, TOKEN_REFERENCE.md §12).
 * - A status the definition does not know is shown as a single neutral node with its
 *   label: the UI never maps an unknown value onto a known state.
 * - Below `md` the rail collapses to one text node ("status: draft") so it never crowds
 *   the command bar.
 */
export function LifecycleRail({
  definition,
  status,
  paymentStatus,
  stateLabel,
  documentAriaLabel,
  paymentAriaLabel,
  className,
}: {
  definition: LifecycleDefinition;
  status: string;
  paymentStatus?: string | null;
  stateLabel: (state: string) => string;
  documentAriaLabel: string;
  paymentAriaLabel: string;
  className?: string;
}) {
  const { sequence, terminal } = definition.document;
  const isTerminal = terminal.includes(status);
  const currentIndex = sequence.indexOf(status);
  const known = isTerminal || currentIndex >= 0;
  const showPayment = status === 'posted' && definition.payment && paymentStatus != null;
  const paymentIndex = showPayment ? (definition.payment as readonly string[]).indexOf(paymentStatus as string) : -1;

  return (
    <div data-awj-lifecycle="" className={cn('flex min-w-0 items-center gap-3', className)}>
      <span className="text-sm font-semibold text-primary-ink md:hidden">{stateLabel(status)}</span>

      <ol aria-label={documentAriaLabel} className="hidden items-center gap-1 md:flex">
        {isTerminal || !known ? (
          <li
            aria-current="step"
            data-awj-step="current"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[13px] font-semibold',
              isTerminal ? 'bg-sunken text-negative' : 'bg-brand-soft text-primary-ink'
            )}
          >
            {isTerminal ? <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> : null}
            {stateLabel(status)}
          </li>
        ) : (
          sequence.map((state, index) => {
            const done = index < currentIndex;
            const current = index === currentIndex;
            return (
              <li
                key={state}
                aria-current={current ? 'step' : undefined}
                data-awj-step={current ? 'current' : done ? 'done' : 'future'}
                data-awj-apex={current ? 'step' : undefined}
                data-awj-apex-on={current ? '' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-control px-2.5 py-1 text-[13px]',
                  current && 'bg-brand-soft font-semibold text-primary-ink',
                  done && 'text-secondary',
                  !done && !current && 'text-secondary'
                )}
              >
                {done ? <Check className="h-3.5 w-3.5 text-positive" strokeWidth={2.2} aria-hidden="true" /> : null}
                {done ? <span className="sr-only">✓ </span> : null}
                {stateLabel(state)}
              </li>
            );
          })
        )}
      </ol>

      {showPayment ? (
        <>
          <span aria-hidden="true" className="hidden h-5 w-px bg-hairline md:block" />
          <ol aria-label={paymentAriaLabel} className="flex items-center gap-1">
            {(definition.payment as readonly string[]).map((state, index) => {
              const current = index === paymentIndex;
              return (
                <li
                  key={state}
                  aria-current={current ? 'step' : undefined}
                  data-awj-step={current ? 'current' : 'future'}
                  className={cn(
                    'rounded-control px-2 py-1 text-[13px]',
                    current ? 'bg-brand-soft font-semibold text-primary-ink' : 'hidden text-secondary lg:inline-flex'
                  )}
                >
                  {stateLabel(state)}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}
    </div>
  );
}

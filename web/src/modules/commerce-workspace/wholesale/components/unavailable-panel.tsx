'use client';

import type { ReactNode } from 'react';
import { useLocale } from 'next-intl';
import { Hourglass } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { commonMessages } from '../messages/common';

/**
 * Honest "not available yet" panel for a capability whose backend contract does not exist. It states the exact
 * blocker (and an optional reference) instead of rendering a control that pretends to work. Purely informative:
 * no inputs, no buttons that look actionable.
 */
export function UnavailablePanel({
  title,
  description,
  blocker,
  reference,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Exact reason this cannot be built on the current backend. */
  blocker: ReactNode;
  reference?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = commonMessages.forLocale(useLocale());

  return (
    <section data-testid="deferred-capability" className="rounded border border-dashed border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Hourglass aria-hidden className="h-4 w-4 text-muted" strokeWidth={1.7} />
        <h3 className="text-sm font-medium text-text">{title}</h3>
        <Badge tone="muted">{t('deferredBadge')}</Badge>
      </div>
      {description ? <p className="mt-2 text-sm leading-relaxed text-muted">{description}</p> : null}
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
          <dt className="shrink-0 text-xs font-medium text-muted sm:pt-0.5">{t('deferredBlocker')}</dt>
          <dd className="text-text">{blocker}</dd>
        </div>
        {reference ? (
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
            <dt className="shrink-0 text-xs font-medium text-muted sm:pt-0.5">{t('deferredReference')}</dt>
            <dd className="num text-muted" dir="ltr">{reference}</dd>
          </div>
        ) : null}
      </dl>
      {children}
    </section>
  );
}

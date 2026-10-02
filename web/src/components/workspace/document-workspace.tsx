'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/tabs';
import { ActionGroup, type PageAction } from '@/components/nebrax/action-group';
import { cn } from '@/lib/utils';

/**
 * Document Workspace grammar (design-system/v3/DOCUMENT_WORKSPACE.md).
 *
 *   R1 DocumentHeader      where am I: back, number (mono), document type, context
 *   R2 DocumentCommandBar  state at the start, actions at the end (one primary, last)
 *   R3 DocumentContext     the parties / document facts, as a dense definition grid
 *   R4 WorkspaceTabs       Items is the hero surface; everything else is a tab
 *   R6 Totals Dock         one per workspace, docked to the bottom of the work area
 *
 * A grammar, not a screenshot: each domain decides its tabs, facts and actions. Every
 * region reuses a central piece — PageAction/ActionGroup for actions, Tabs for tabs,
 * <TotalsDock>, <LifecycleRail> — nothing here is invoice-specific.
 */

export function DocumentWorkspace({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div data-awj-docws="" className={cn('flex flex-col', className)}>
      {children}
    </div>
  );
}

export function DocumentHeader({
  backHref,
  backLabel,
  number,
  typeLabel,
  badges,
  note,
}: {
  backHref: string;
  backLabel: string;
  number: React.ReactNode;
  typeLabel: string;
  badges?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <header data-awj-docws-header="" className="no-print flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button asChild variant="ghost" size="icon" aria-label={backLabel}>
        <Link href={backHref}>
          <ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} aria-hidden="true" />
        </Link>
      </Button>
      <span className="text-sm text-secondary">{typeLabel}</span>
      <h1 className="num text-lg font-semibold text-primary-ink">{number}</h1>
      {badges}
      {note ? <p className="w-full text-sm text-secondary md:ms-auto md:w-auto">{note}</p> : null}
    </header>
  );
}

export function DocumentCommandBar({
  state,
  actions,
  toolbarLabel,
}: {
  /** Lifecycle rail (start). */
  state: React.ReactNode;
  /** Secondary actions then the single primary action last (ActionGroup keeps that order). */
  actions: PageAction[];
  toolbarLabel: string;
}) {
  return (
    <div
      data-awj-cmdbar=""
      role="toolbar"
      aria-label={toolbarLabel}
      className="no-print flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
    >
      <div className="min-w-0">{state}</div>
      <ActionGroup actions={actions} inlineLimit={2} />
    </div>
  );
}

export interface DocumentFact {
  label: string;
  value: React.ReactNode;
}

export function DocumentContext({ facts, party }: { facts: DocumentFact[]; party?: React.ReactNode }) {
  return (
    <section data-awj-docws-context="" className="no-print grid gap-x-6 gap-y-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]">
      {party ? <div data-awj-docws-party="">{party}</div> : null}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-sm sm:grid-cols-3">
        {facts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs text-secondary">{fact.label}</dt>
            <dd className="mt-0.5 truncate text-primary-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export interface WorkspaceTab {
  id: string;
  label: string;
  count?: number;
  content: React.ReactNode;
  /** Hidden entirely (not disabled) — e.g. no permission to see journal entries. */
  hidden?: boolean;
  /**
   * Keep the panel mounted while inactive (hidden on screen, still shown in print). Needed for
   * panels other code reads from the DOM (print/PDF root).
   */
  keepMounted?: boolean;
}

export function WorkspaceTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: WorkspaceTab[];
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useTranslations('nebrax');
  const visible = tabs.filter((tab) => !tab.hidden);
  const active = visible.find((tab) => tab.id === value) ?? visible[0];

  return (
    <section data-awj-docws-tabs="" aria-label={t('documentSections')}>
      <Tabs
        tabs={visible.map(({ id, label, count }) => ({ id, label, count }))}
        value={active?.id ?? null}
        onChange={onChange}
      />
      {visible.map((tab) => {
        const isActive = tab.id === active?.id;
        if (!isActive && !tab.keepMounted) return null;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`panel-${tab.id}`}
            aria-labelledby={`tab-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            hidden={!isActive && !tab.keepMounted}
            className={cn(!isActive && 'hidden print:block')}
          >
            {tab.content}
          </div>
        );
      })}
    </section>
  );
}

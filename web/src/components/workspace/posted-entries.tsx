'use client';

import * as React from 'react';
import Link from 'next/link';
import { BookOpen, Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';

/**
 * Posted journal entries — a READ-ONLY view of entries the backend already created and
 * linked to a document (design-system/v3/POSTING_PREVIEW.md mode A).
 *
 * Contract:
 * - Every line, number and status comes from the server's response. This component
 *   performs no arithmetic: no totals, no balance check, no inference of a missing entry.
 * - No linked entry → an explicit empty message (never a synthesized one).
 * - There is NO draft preview here: a draft document has no linked entry, and a draft
 *   posting preview is a separate backend/accounting decision (not built).
 * - Permission is the server's call: callers hide the tab when the endpoint is forbidden.
 */
export interface PostedEntryLine {
  account_id: string;
  account_code: string | null;
  account_name: string | null;
  description: string | null;
  debit: string;
  credit: string;
}

export interface PostedEntry {
  id: string;
  number: string;
  date: string | null;
  status: string;
  description: string | null;
  lines: PostedEntryLine[];
}

export interface PostedEntriesLabels {
  entryNumber: string;
  entryDate: string;
  description: string;
  account: string;
  debit: string;
  credit: string;
  openEntry: string;
  readOnly: string;
}

export function PostedEntries({
  groups,
  labels,
  statusLabel,
  statusTone,
}: {
  groups: { key: string; title: string; entry: PostedEntry | null; empty: string }[];
  labels: PostedEntriesLabels;
  statusLabel: (status: string) => string;
  statusTone: (status: string) => 'positive' | 'muted' | 'negative';
}) {
  return (
    <div data-awj-posted-entries="" className="divide-y divide-hairline">
      {groups.map(({ key, title, entry, empty }) => (
        <section key={key} aria-label={title} className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-primary-ink">
              <BookOpen className="h-4 w-4 text-primary" strokeWidth={1.8} aria-hidden="true" />
              {title}
            </h3>
            {entry ? (
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs text-secondary">
                  <Lock className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
                  {labels.readOnly}
                </span>
                <Badge tone={statusTone(entry.status)}>{statusLabel(entry.status)}</Badge>
              </span>
            ) : null}
          </div>

          {entry ? (
            <>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-secondary">{labels.entryNumber}</dt>
                  <dd className="num mt-0.5 text-primary-ink">{entry.number}</dd>
                </div>
                <div>
                  <dt className="text-xs text-secondary">{labels.entryDate}</dt>
                  <dd className="num mt-0.5 text-primary-ink">{entry.date ?? '—'}</dd>
                </div>
                {entry.description ? (
                  <div className="col-span-2">
                    <dt className="text-xs text-secondary">{labels.description}</dt>
                    <dd className="mt-0.5 text-primary-ink">{entry.description}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="overflow-x-auto rounded-surface border border-hairline">
                <table data-awj-linegrid-view="" className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr>
                      <th scope="col" className="text-start">{labels.account}</th>
                      <th scope="col" className="text-start">{labels.description}</th>
                      <th scope="col" className="text-end">{labels.debit}</th>
                      <th scope="col" className="text-end">{labels.credit}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((line, index) => (
                      <tr key={`${entry.id}-${line.account_id}-${index}`}>
                        <td>
                          <span className="num text-secondary">{line.account_code}</span>
                          {line.account_name ? <span> · {line.account_name}</span> : null}
                        </td>
                        <td className="text-secondary">{line.description ?? '—'}</td>
                        <td className="text-end"><Money value={line.debit} /></td>
                        <td className="text-end"><Money value={line.credit} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Link href={`/journal-entries/${entry.id}`} className="inline-flex text-sm text-primary hover:underline">
                {labels.openEntry}
              </Link>
            </>
          ) : (
            <p className="rounded-surface border border-dashed border-hairline bg-band px-3 py-4 text-sm leading-6 text-secondary">{empty}</p>
          )}
        </section>
      ))}
    </div>
  );
}

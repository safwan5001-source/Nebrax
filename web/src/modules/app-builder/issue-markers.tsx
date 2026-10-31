'use client';

import * as React from 'react';
import type { AppSchemaComponent, ContractIssue } from '@/lib/app-builder';

export type IssueSeverity = 'error' | 'warning';

/** عقد → أشدّ خطورة لمشكلاتها في الصفحة المعروضة (`error` يغلب `warning`). مصدر الشارات في الشجرة وقائمة الأقسام. */
export type IssueMarkers = ReadonlyMap<string, IssueSeverity>;

const EMPTY: IssueMarkers = new Map();
const IssueMarkersContext = React.createContext<IssueMarkers>(EMPTY);

export function IssueMarkersProvider({ markers, children }: { markers: IssueMarkers; children: React.ReactNode }) {
  return <IssueMarkersContext.Provider value={markers}>{children}</IssueMarkersContext.Provider>;
}

export function useIssueMarker(nodeId: string): IssueSeverity | null {
  return React.useContext(IssueMarkersContext).get(nodeId) ?? null;
}

/** يبني خريطة الشارات لصفحة واحدة؛ مشكلات بلا `node_id` أو لصفحة أخرى لا تدخل. */
export function buildIssueMarkers(issues: ContractIssue[], pageId: string | null): IssueMarkers {
  const map = new Map<string, IssueSeverity>();
  if (!pageId) return map;
  for (const issue of issues) {
    if (issue.page_id !== pageId || !issue.node_id) continue;
    const severity: IssueSeverity = issue.blocks_publish ? 'error' : 'warning';
    if (severity === 'error' || !map.has(issue.node_id)) map.set(issue.node_id, severity);
  }
  return map;
}

/** أشدّ شارة داخل قسم (القسم نفسه أو أي حفيد) — لصف قائمة الأقسام في الوضع السهل. */
export function sectionMarker(section: AppSchemaComponent, markers: IssueMarkers): IssueSeverity | null {
  let best: IssueSeverity | null = null;
  const visit = (node: AppSchemaComponent) => {
    const m = markers.get(node.id);
    if (m === 'error') best = 'error';
    else if (m === 'warning' && best === null) best = 'warning';
    node.children?.forEach(visit);
  };
  visit(section);
  return best;
}

/** نقطة لونية + نص وصول (اللون وحده لا يكفي). */
export function IssueDot({ severity, label }: { severity: IssueSeverity; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center" title={label}>
      <span aria-hidden="true" className={severity === 'error' ? 'h-2 w-2 rounded-full bg-negative' : 'h-2 w-2 rounded-full bg-warning'} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

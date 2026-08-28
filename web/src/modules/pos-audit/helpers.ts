import type { Band, CasePriority, CaseStatus, Severity } from './types';

/** المعدّل المطبّع من مقياس ×1000 إلى قيمة معروضة بخانتين. */
export function fromMilli(milli: number | null | undefined): string {
  if (milli === null || milli === undefined) return '—';
  return (milli / 1000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** لهجة Badge للشدّة — يصاحبها دائماً نص، فلا يُبلَّغ المعنى باللون وحده. */
export function severityTone(severity: Severity): 'muted' | 'warning' | 'negative' {
  return severity === 'priority' ? 'negative' : severity === 'review' ? 'warning' : 'muted';
}

export function bandTone(band: Band): 'positive' | 'muted' | 'warning' | 'negative' {
  switch (band) {
    case 'priority':
      return 'negative';
    case 'review':
      return 'warning';
    case 'watch':
      return 'muted';
    default:
      return 'positive';
  }
}

export function reviewStateTone(state: string): 'neutral' | 'muted' | 'positive' | 'warning' | 'negative' {
  switch (state) {
    case 'new':
      return 'neutral';
    case 'reviewing':
      return 'warning';
    case 'explained':
      return 'positive';
    case 'dismissed':
      return 'muted';
    case 'needs_investigation':
      return 'negative';
    default:
      return 'muted';
  }
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-SA' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function caseStatusTone(status: CaseStatus): 'neutral' | 'muted' | 'positive' | 'warning' | 'negative' {
  switch (status) {
    case 'open':
      return 'neutral';
    case 'investigating':
    case 'awaiting_information':
      return 'warning';
    case 'explained':
    case 'closed':
      return 'positive';
    case 'dismissed':
      return 'muted';
    case 'control_failure':
      return 'warning';
    case 'confirmed_loss':
      return 'negative';
    default:
      return 'muted';
  }
}

export function casePriorityTone(priority: CasePriority): 'muted' | 'neutral' | 'warning' | 'negative' {
  switch (priority) {
    case 'critical':
      return 'negative';
    case 'high':
      return 'warning';
    case 'normal':
      return 'neutral';
    default:
      return 'muted';
  }
}

/** يبني سلسلة استعلام من قيم غير فارغة، مع دعم المصفوفات (category[]، severity[]). */
export function buildQuery(params: Record<string, string | string[] | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      value.filter(Boolean).forEach((item) => search.append(`${key}[]`, String(item)));
    } else {
      search.set(key, String(value));
    }
  }
  return search.toString();
}

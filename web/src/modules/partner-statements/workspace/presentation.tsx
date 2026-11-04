'use client';

/**
 * عرض مشترك لمساحة المراجعة: شارات النتيجة والقرار، وعرض مبلغ السطر (مدين/دائن) بأرقام لاتينية LTR. نص + لون + أيقونة (لا اللون وحده، D6).
 */
import { AlertTriangle, CheckCircle2, CircleDashed, CircleHelp, Clock3, Link2, MinusCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { formatMinor } from '../contract';
import type { Decision, MatchOutcome, StatementLine } from './types';

type Translate = (key: string, values?: Record<string, string | number>) => string;
type Tone = 'muted' | 'warning' | 'positive' | 'negative' | 'neutral';

const OUTCOME_TONE: Record<string, Tone> = {
  matched: 'positive',
  amount_difference: 'warning',
  date_difference: 'warning',
  ambiguous: 'neutral',
  missing_in_books: 'negative',
  missing_in_statement: 'muted',
  needs_review: 'warning',
  neutralised: 'muted',
  incomplete: 'warning',
};

const OUTCOME_ICON: Record<string, typeof CheckCircle2> = {
  matched: CheckCircle2,
  amount_difference: AlertTriangle,
  date_difference: Clock3,
  ambiguous: CircleHelp,
  missing_in_books: XCircle,
  missing_in_statement: CircleDashed,
  needs_review: AlertTriangle,
  neutralised: MinusCircle,
  incomplete: AlertTriangle,
};

export function OutcomeBadge({ outcome, t }: { outcome: MatchOutcome | string; t: Translate }) {
  const Icon = OUTCOME_ICON[outcome] ?? CircleHelp;
  const known = outcome in OUTCOME_TONE;
  return (
    <Badge tone={OUTCOME_TONE[outcome] ?? 'muted'} data-outcome={outcome}>
      <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
      {known ? t(`workspace.outcome.${outcome}`) : t('workspace.outcome.unknown')}
    </Badge>
  );
}

export type DecisionBadgeState = 'none' | 'current' | 'other_run';

export function DecisionBadge({ decision, state, t }: { decision: Decision | null | undefined; state: DecisionBadgeState; t: Translate }) {
  if (!decision || state === 'none') {
    return (
      <Badge tone="muted" data-decision="none">
        <CircleDashed className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
        {t('workspace.decision.none')}
      </Badge>
    );
  }
  if (state === 'other_run') {
    return (
      <Badge tone="warning" data-decision="other_run">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
        {t('workspace.decision.other_run')}
      </Badge>
    );
  }
  const Icon = decision.action === 'link_pair' ? Link2 : CheckCircle2;
  return (
    <Badge tone={decision.action === 'dismiss' ? 'negative' : 'neutral'} data-decision={decision.action}>
      <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
      {t(`workspace.action.${decision.action}`)}
    </Badge>
  );
}

/** مبلغ السطر: العمود الذي فيه قيمة (مدين أو دائن) مع وسمه — LTR دائماً. */
export function LineAmount({ line, t }: { line: Pick<StatementLine, 'debit_minor' | 'credit_minor'>; t: Translate }) {
  const debit = line.debit_minor > 0;
  const amount = debit ? line.debit_minor : line.credit_minor;
  return (
    <span className="num whitespace-nowrap" dir="ltr">
      <span className="text-xs text-muted">{debit ? t('workspace.debit') : t('workspace.credit')}</span> {formatMinor(amount)}
    </span>
  );
}

export function Money({ minor, signed = false }: { minor: number | null | undefined; signed?: boolean }) {
  const text = formatMinor(minor);
  return (
    <span className="num whitespace-nowrap" dir="ltr">
      {signed && typeof minor === 'number' && minor > 0 ? '+' : ''}
      {text}
    </span>
  );
}

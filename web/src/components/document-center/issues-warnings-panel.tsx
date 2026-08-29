'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { issueSeverityTone } from '@/lib/document-review';
import type { ReviewIssue } from '@/modules/document-center/contract';
import type { MatchCommand } from '@/components/document-center/matching-panel';

type Props = {
  issues: ReviewIssue[];
  warnings: string[];
  batchId: string;
  canMutate: boolean;
  onCommand: (command: MatchCommand) => void;
};

export function IssuesWarningsPanel({ issues, warnings, batchId, canMutate, onCommand }: Props) {
  const t = useTranslations('documentCenterReview');

  return (
    <div className="space-y-4">
      {warnings.length > 0 && (
        <Card>
          <CardContent className="py-5">
            <h2 className="font-semibold text-text">{t('extractionWarnings')}</h2>
            <ul className="mt-3 space-y-2">
              {warnings.map((warning, index) => (
                <li key={`${index}-${warning.slice(0, 24)}`} className="flex items-start gap-2 rounded border border-warning/30 bg-warning/5 p-3 text-sm text-text">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-semibold text-text">{t('issuesTitle')}</h2>
            <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          </div>
          {issues.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('noIssues')}</p>
          ) : (
            <div className="mt-4 space-y-3">
              {issues.map((issue) => {
                const isBlockingTaxIssue = issue.severity === 'blocking' && issue.code.startsWith('tax_');
                const action = isBlockingTaxIssue ? 'revalidateFinancial' : issue.status === 'resolved' ? 'reopen' : 'resolve';
                const endpoint = isBlockingTaxIssue
                  ? `/document-batches/${batchId}/revalidate-financial`
                  : `/document-issues/${issue.id}/${action}`;

                return (
                  <article key={issue.id} className="rounded border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-text">{issue.code}</p>
                        <p className="mt-1 text-sm text-muted">{issue.safe_message}</p>
                      </div>
                      <Badge tone={issueSeverityTone(issue.severity)}>{t(issue.severity as 'blocking' | 'warning')}</Badge>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <Badge tone={issue.status === 'resolved' ? 'positive' : 'warning'}>
                        {t(issue.status as 'open' | 'resolved')}
                      </Badge>
                      {canMutate && (
                        <Button
                          size="sm"
                          onClick={() => onCommand({
                            title: t(action),
                            label: t(action),
                            endpoint,
                          })}
                        >
                          {t(action)}
                        </Button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

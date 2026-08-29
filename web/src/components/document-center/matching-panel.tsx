'use client';

import { useTranslations } from 'next-intl';
import { ListChecks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  confidencePercentage,
  documentFieldTranslationKey,
  matchStatusTone,
} from '@/lib/document-review';
import type { DocumentMatch } from '@/modules/document-center/contract';

export type MatchCommand = {
  title: string;
  label: string;
  endpoint: string;
  payload?: Record<string, unknown>;
};

type Props = {
  matches: DocumentMatch[];
  canMutate: boolean;
  onCommand: (command: MatchCommand) => void;
};

export function MatchingPanel({ matches, canMutate, onCommand }: Props) {
  const t = useTranslations('documentCenterReview');

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold text-text">{t('matches')}</h2>
          <ListChecks className="h-5 w-5 text-muted" aria-hidden="true" />
        </div>
        {matches.length === 0 ? (
          <p className="mt-4 text-sm text-muted">{t('noMatches')}</p>
        ) : (
          <div className="mt-4 space-y-4">
            {matches.map((match) => {
              const unresolved = !['confirmed', 'rejected'].includes(match.status);
              return (
                <article key={match.id} className={`rounded border p-3 ${unresolved ? 'border-warning/40 bg-warning/5' : 'border-border'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-text">{t(documentFieldTranslationKey(match.subject_key))}</p>
                      <p className="mt-1 text-xs text-muted">
                        {match.strategy}
                        {' · '}
                        {t('score', { score: confidencePercentage(match.score_basis_points) ?? 0 })}
                      </p>
                      {unresolved && <p className="mt-1 text-xs text-warning">{t('matchUnresolved')}</p>}
                    </div>
                    <Badge tone={matchStatusTone(match.status)}>
                      {t(match.status as 'confirmed' | 'suggested' | 'rejected')}
                    </Badge>
                  </div>
                  <div className="mt-3 space-y-2">
                    {match.candidates.map((candidate) => (
                      <div key={candidate.id} className="rounded border border-border bg-surface p-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium text-text">{candidate.label}</p>
                            <p className="mt-1 text-xs text-muted">
                              {[candidate.sku, candidate.unit, candidate.strategy].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge tone={candidate.is_active ? 'neutral' : 'muted'}>
                              {t('score', { score: confidencePercentage(candidate.score_basis_points) ?? 0 })}
                            </Badge>
                            {canMutate && (
                              <Button
                                size="sm"
                                onClick={() => onCommand({
                                  title: t('confirm'),
                                  label: t('confirm'),
                                  endpoint: `/document-match-results/${match.id}/confirm`,
                                  payload: { candidate_id: candidate.id },
                                })}
                                disabled={!candidate.is_active}
                                title={!candidate.is_active ? t('inactiveCandidate') : undefined}
                              >
                                {t('confirm')}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {canMutate && (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onCommand({
                          title: t('reject'),
                          label: t('reject'),
                          endpoint: `/document-match-results/${match.id}/reject`,
                        })}
                      >
                        {t('reject')}
                      </Button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { GitCompareArrows, History } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { compareTemplateRevisions, formatRevisionValue } from '@/modules/print-templates/services/revision-comparison';

export interface TemplateRevisionHistoryItem {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  document_types: string[];
  definition: object;
  published_at?: string | null;
  created_at?: string | null;
}

interface TemplateRevisionHistoryProps {
  revisions: TemplateRevisionHistoryItem[] | undefined;
  loading: boolean;
  failed: boolean;
}

export function TemplateRevisionHistory({ revisions, loading, failed }: TemplateRevisionHistoryProps) {
  const t = useTranslations('printTemplateStudio');
  const sorted = useMemo(
    () => [...(revisions ?? [])].sort((first, second) => second.version - first.version),
    [revisions],
  );
  const [beforeId, setBeforeId] = useState<string | null>(null);
  const [afterId, setAfterId] = useState<string | null>(null);

  useEffect(() => {
    setAfterId(sorted[0]?.id ?? null);
    setBeforeId(sorted[1]?.id ?? null);
  }, [sorted]);

  const before = sorted.find((revision) => revision.id === beforeId) ?? null;
  const after = sorted.find((revision) => revision.id === afterId) ?? null;
  const changes = useMemo(
    () => before && after
      ? compareTemplateRevisions(
        { documentTypes: before.document_types, definition: before.definition },
        { documentTypes: after.document_types, definition: after.definition },
      )
      : [],
    [after, before],
  );

  const status = (revision: TemplateRevisionHistoryItem) => t(`revision_status_${revision.status}`);
  const optionLabel = (revision: TemplateRevisionHistoryItem) => `${t('revision', { version: revision.version })} · ${status(revision)}`;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border py-3">
        <div>
          <CardTitle className="text-sm">{t('revision_history')}</CardTitle>
          <p className="mt-1 text-xs text-muted">{t('revision_history_hint')}</p>
        </div>
        <History className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        {loading ? (
          <p className="text-sm text-muted">{t('revision_history_loading')}</p>
        ) : failed ? (
          <p className="text-sm text-negative">{t('revision_history_failed')}</p>
        ) : sorted.length < 2 ? (
          <p className="text-sm text-muted">{t('revision_history_single')}</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="revision-before">{t('revision_before')}</Label>
                <Select id="revision-before" value={beforeId ?? ''} onChange={(event) => setBeforeId(event.target.value)}>
                  {sorted.map((revision) => <option key={revision.id} value={revision.id}>{optionLabel(revision)}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="revision-after">{t('revision_after')}</Label>
                <Select id="revision-after" value={afterId ?? ''} onChange={(event) => setAfterId(event.target.value)}>
                  {sorted.map((revision) => <option key={revision.id} value={revision.id}>{optionLabel(revision)}</option>)}
                </Select>
              </div>
            </div>

            {before && after && before.id === after.id ? (
              <p className="text-sm text-muted">{t('revision_select_distinct')}</p>
            ) : changes.length ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-medium text-text">
                  <GitCompareArrows className="h-4 w-4 text-primary" aria-hidden="true" />
                  <span>{t('revision_change_count', { count: changes.length })}</span>
                </div>
                <div className="overflow-x-auto rounded border border-border">
                  <table className="min-w-full text-start text-xs">
                    <thead className="bg-surface text-muted">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('revision_field')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('revision_before')}</th>
                        <th scope="col" className="px-3 py-2 text-start font-medium">{t('revision_after')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {changes.map((change) => (
                        <tr key={change.path}>
                          <th scope="row" className="whitespace-nowrap px-3 py-2 text-start font-medium text-text">{change.path.replace(/^definition\./, '')}</th>
                          <td className="max-w-72 px-3 py-2 align-top text-muted"><code className="break-words">{formatRevisionValue(change.before, t('revision_empty_value'))}</code></td>
                          <td className="max-w-72 px-3 py-2 align-top text-text"><code className="break-words">{formatRevisionValue(change.after, t('revision_empty_value'))}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">{t('revision_no_changes')}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

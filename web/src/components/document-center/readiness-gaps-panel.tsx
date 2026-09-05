'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { documentFieldTranslationKey, readinessGapTranslationKey } from '@/lib/document-review';
import type { ReadinessGap, ReviewField } from '@/modules/document-center/contract';

type EditTarget = { fieldLabel: string; targetKey: string; value: string | number | boolean | null };

type Props = {
  gaps: ReadinessGap[];
  fields: ReviewField[];
  canEdit: boolean;
  onEdit: (target: EditTarget) => void;
};

/**
 * فجوات جاهزية استباقية (اليوم: سند تسليم فقط) — تُعرض قبل الضغط على «إكمال
 * المراجعة» بدل الاعتماد على رسالة الرفض التفاعلية وحدها. المصدر الوحيد
 * للحقيقة هو `DocumentReviewReadinessPolicy::deliveryNoteGaps()` نفسه الذي
 * يستهلكه الإكمال الفعلي — لا تكرار منطق هنا، فقط عرض.
 */
export function ReadinessGapsPanel({ gaps, fields, canEdit, onEdit }: Props) {
  const t = useTranslations('documentCenterReview');

  if (gaps.length === 0) return null;

  function editableTarget(gap: ReadinessGap): EditTarget | null {
    if (!gap.target_key || !gap.target_key.startsWith('fields.')) return null;
    const key = gap.target_key.slice('fields.'.length);
    const field = fields.find((item) => item.key === key);

    return { fieldLabel: t(documentFieldTranslationKey(key)), targetKey: gap.target_key, value: field?.current ?? null };
  }

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-warning" aria-hidden="true" />
          <h2 className="font-semibold text-text">{t('readinessGapsTitle')}</h2>
        </div>
        <p className="mt-1 text-sm text-muted">{t('readinessGapsHint')}</p>
        <ul className="mt-3 space-y-2">
          {gaps.map((gap) => {
            const translationKey = readinessGapTranslationKey(gap.code);
            const target = editableTarget(gap);

            return (
              <li key={gap.code} className="flex flex-wrap items-center justify-between gap-2 rounded border border-warning/30 bg-warning/5 p-3 text-sm text-text">
                <span>{translationKey ? t(translationKey) : gap.code}</span>
                {canEdit && target && (
                  <Button size="sm" variant="outline" onClick={() => onEdit(target)}>
                    {t('readinessGapEdit')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

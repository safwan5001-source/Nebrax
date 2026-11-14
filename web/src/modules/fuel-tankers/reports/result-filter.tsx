'use client';

import { useTranslations } from 'next-intl';
import { Select } from '@/components/ui/select';
import { RESULTS, type Result } from './logic';

export type ResultFilter = Result | 'all';

/** تصفية **محلية** للصفوف المحمَّلة بنتيجة المطابقة (لا طلب جديد، ولا تغيير للملخص الخادمي). */
export function ResultFilterSelect({ value, onChange }: { value: ResultFilter; onChange: (value: ResultFilter) => void }) {
  const t = useTranslations('fuelTankerReports');
  return (
    <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
      <span className="text-muted">{t('resultFilter.label')}</span>
      <Select className="max-md:min-h-11" value={value} aria-label={t('resultFilter.label')} onChange={(event) => onChange(event.target.value as ResultFilter)} data-result-filter="">
        <option value="all">{t('resultFilter.all')}</option>
        {RESULTS.map((r) => <option key={r} value={r}>{t(`result.${r}`)}</option>)}
      </Select>
    </label>
  );
}

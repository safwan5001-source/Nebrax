'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { fetchPartners, type PartnerOption } from './client';
import type { PartnerRole } from './contract';

const DEBOUNCE_MS = 300;

/**
 * منتقي طرف ببحث خادمي: حقل بحث + قائمة أصلية `<select>` (الأنسب لمس الجوال). الخادم يصفّي الشركاء بالدور ورؤية المستخدم،
 * ولا تُعتمد القائمة للأمان — المعاينة والتنفيذ يعيدان التحقق من رؤية الطرف والدور. الطرف المختار يبقى في الخيارات حتى لو غاب عن نتيجة بحث لاحق.
 */
export function PartnerPicker({
  role,
  value,
  onChange,
  disabled = false,
  label,
  error,
}: {
  role: PartnerRole | '';
  value: string;
  onChange: (id: string, name: string) => void;
  disabled?: boolean;
  label: string;
  error?: string | null;
}) {
  const t = useTranslations('partnerStatements');
  const baseId = useId();
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<PartnerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const known = useRef(new Map<string, PartnerOption>());

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      fetchPartners(role, search)
        .then((list) => {
          if (!live) return;
          list.forEach((partner) => known.current.set(partner.id, partner));
          setOptions(list);
        })
        .catch(() => {
          if (live) setFailed(true);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [role, search]);

  const selected = value ? known.current.get(value) : undefined;
  const shown = selected && !options.some((option) => option.id === selected.id) ? [selected, ...options] : options;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${baseId}-select`}>{label}</Label>
      <Input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={t('partner.search_placeholder')}
        aria-label={t('partner.search_label')}
        maxLength={100}
        disabled={disabled}
        autoComplete="off"
      />
      <Select
        id={`${baseId}-select`}
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${baseId}-error` : undefined}
        onChange={(event) => {
          const id = event.target.value;
          onChange(id, known.current.get(id)?.name ?? '');
        }}
      >
        <option value="">{loading ? t('partner.loading') : t('partner.choose')}</option>
        {shown.map((partner) => (
          <option key={partner.id} value={partner.id}>
            {partner.name}
            {partner.code ? ` · ${partner.code}` : ''}
          </option>
        ))}
      </Select>
      {failed ? <p role="alert" className="text-xs text-negative">{t('partner.load_failed')}</p> : null}
      {!failed && !loading && shown.length === 0 ? <p className="text-xs text-muted">{t('partner.none')}</p> : null}
      {error ? <p id={`${baseId}-error`} role="alert" className="text-xs text-negative">{error}</p> : null}
    </div>
  );
}

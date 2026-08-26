'use client';

import { useLocale } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { DocumentLanguageMode } from '../document-language';

export function DocumentLanguageSelector({
  value,
  disabled = false,
  onChange,
}: {
  value: DocumentLanguageMode;
  disabled?: boolean;
  onChange: (value: DocumentLanguageMode) => void;
}) {
  const locale = useLocale();
  const ar = locale === 'ar';

  return (
    <div className="space-y-1.5">
      <Label htmlFor="document-language-mode">
        {ar ? 'لغة المستند' : 'Document language'}
      </Label>
      <Select
        id="document-language-mode"
        className="h-11"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as DocumentLanguageMode)}
      >
        <option value="ar">{ar ? 'العربية' : 'Arabic'}</option>
        <option value="en">English</option>
        <option value="bilingual">{ar ? 'عربي + English' : 'Arabic + English'}</option>
      </Select>
      <p className="text-xs text-muted">
        {ar
          ? 'مستقل عن القالب المرئي؛ يمكنك استخدام ERP أو Modern أو Minimal بأي لغة.'
          : 'Independent from visual style; ERP, Modern, and Minimal work with every language mode.'}
      </p>
    </div>
  );
}

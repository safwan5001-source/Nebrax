'use client';

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** عناصر الهوية التي لا يدعمها Runtime اليوم: تُعرض مقترحة معطّلة بسببها (الصدق قبل الاكتمال — مواصفة V2 §4.5). */
export const PROPOSED_IDENTITY_ITEMS = ['logo', 'font', 'darkMode', 'splash', 'onboarding'] as const;

/** هوية التطبيق (الوضع السهل): اسم التطبيق بالعربية والإنجليزية + بنود الهوية المقترحة. لون التطبيق في تبويب المظهر (يبقى كما هو حتى AD-03). */
export function EasyIdentityPanel({
  name, nameEn, canManage, saving, onSave, t,
}: {
  name: string;
  nameEn: string | null;
  canManage: boolean;
  saving: boolean;
  onSave: (name: string, nameEn: string | null) => void;
  t: Translate;
}) {
  const [draftName, setDraftName] = React.useState(name);
  const [draftEn, setDraftEn] = React.useState(nameEn ?? '');
  React.useEffect(() => { setDraftName(name); setDraftEn(nameEn ?? ''); }, [name, nameEn]);

  const trimmed = draftName.trim();
  const changed = trimmed !== name || draftEn.trim() !== (nameEn ?? '');
  const valid = trimmed.length > 0 && trimmed.length <= 255 && draftEn.trim().length <= 255;

  return (
    <div className="space-y-4 p-3" data-testid="easy-identity">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-text" htmlFor="easy-app-name">{t('easy.identity.name')}</label>
        <Input id="easy-app-name" value={draftName} maxLength={255} disabled={!canManage || saving} onChange={(e) => setDraftName(e.target.value)} />
        <label className="block text-xs font-medium text-text" htmlFor="easy-app-name-en">{t('easy.identity.nameEn')}</label>
        <Input id="easy-app-name-en" dir="ltr" value={draftEn} maxLength={255} disabled={!canManage || saving} onChange={(e) => setDraftEn(e.target.value)} />
        <Button type="button" size="sm" disabled={!canManage || saving || !changed || !valid} onClick={() => onSave(trimmed, draftEn.trim() === '' ? null : draftEn.trim())}>
          {saving ? t('easy.identity.saving') : t('easy.identity.save')}
        </Button>
        <p className="text-[11px] text-muted">{t('easy.identity.nameNote')}</p>
      </div>
      <ul className="space-y-1.5" aria-label={t('easy.identity.proposedTitle')}>
        {PROPOSED_IDENTITY_ITEMS.map((item) => (
          <li key={item} className="flex items-start gap-2 rounded-md border border-border p-2">
            <div className="min-w-0 flex-1">
              <span className="text-sm text-text">{t(`easy.identity.items.${item}`)}</span>
              <p className="text-[11px] text-muted">{t('easy.identity.proposedReason')}</p>
            </div>
            <Badge tone="muted">{t('easy.status.proposed')}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

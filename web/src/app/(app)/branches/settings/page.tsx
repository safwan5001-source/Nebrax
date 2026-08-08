'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import type { Branch, BranchSettings } from '@/lib/branch';

/** مفاتيح المشاركة الخمسة — ترتيبها ونصوصها من المرجع الوظيفي. */
const TOGGLES = [
  'share_customers',
  'share_products',
  'share_suppliers',
  'share_cost_centers',
  'account_branch_scoping',
] as const;

type ToggleKey = (typeof TOGGLES)[number];

export default function BranchSettingsPage() {
  const t = useTranslations('branchSettings');
  const tc = useTranslations('common');
  const { success, error: errorToast } = useToast();

  const [branches, setBranches] = useState<Branch[]>([]);
  const [cfg, setCfg] = useState<BranchSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      api<{ data: Branch[] }>('/branches'),
      api<{ data: BranchSettings }>('/branch-settings'),
    ])
      .then(([b, s]) => { setBranches(b.data); setCfg(s.data); })
      .catch(() => errorToast(tc('error')));
  }, [errorToast, tc]);

  const patch = (p: Partial<BranchSettings>) => setCfg((c) => (c ? { ...c, ...p } : c));

  async function save() {
    if (!cfg) return;
    setSaving(true);
    try {
      await api('/branch-settings', { method: 'PUT', body: cfg });
      success(tc('updated'));
    } catch {
      errorToast(tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{t('subtitle')}</p>
        </div>
        {cfg && <Button onClick={save} disabled={saving}>{saving ? tc('loading') : tc('save')}</Button>}
      </div>

      {!cfg ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle>{t('main_branch')}</CardTitle></CardHeader>
            <CardContent className="space-y-1.5">
              <Label htmlFor="main">{t('main_branch')}</Label>
              <Select
                id="main"
                value={cfg.main_branch_id ?? ''}
                onChange={(e) => patch({ main_branch_id: e.target.value || null })}
                className="max-w-md"
              >
                <option value="">{t('no_main')}</option>
                {branches.map((b) => (<option key={b.id} value={b.id}>{b.name}</option>))}
              </Select>
              <p className="text-xs text-muted">{t('main_branch_hint')}</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('sharing')}</CardTitle></CardHeader>
            <CardContent className="divide-y divide-border p-0">
              {TOGGLES.map((key: ToggleKey) => (
                <div key={key} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div id={`lbl-${key}`} className="text-sm font-medium text-text">{t(`${key}_title`)}</div>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{t(`${key}_desc`)}</p>
                  </div>
                  <Switch
                    checked={cfg[key]}
                    onCheckedChange={(v) => patch({ [key]: v } as Partial<BranchSettings>)}
                    aria-labelledby={`lbl-${key}`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <p className="text-xs text-muted">{t('footer_note')}</p>
        </>
      )}
    </div>
  );
}

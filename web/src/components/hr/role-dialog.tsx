'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface Role {
  id: string;
  slug: string;
  name: string;
  permissions: string[];   // ["*"] = وصول كامل
  is_system: boolean;
  is_owner: boolean;
  users_count: number;
}

/** ترتيب عرض الأفعال داخل كل وحدة. */
const ACTION_ORDER = ['view', 'manage'];

export function RoleDialog({
  open,
  onClose,
  onSaved,
  role,
  catalog,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  role?: Role | null;
  catalog: string[];        // كل الصلاحيات القابلة للإسناد، من meta.permissions
}) {
  const t = useTranslations('hr');
  const tc = useTranslations('common');
  const { success } = useToast();
  const modLabels = t.raw('perm_modules') as Record<string, string>;

  const readOnly = role?.is_owner ?? false;
  const hasWildcard = (role?.permissions ?? []).includes('*');

  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // الوحدات وأفعالها، مشتقّةً من الكتالوج (partners → [view, manage] …).
  const modules = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const perm of catalog) {
      const [mod, action] = perm.split('.');
      if (!map.has(mod)) map.set(mod, []);
      map.get(mod)!.push(action);
    }
    for (const actions of map.values()) {
      actions.sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));
    }
    return [...map.entries()];
  }, [catalog]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName(role?.name ?? '');
    // الوصول الكامل (`*`) يُعرض بكل الصلاحيات مختارةً؛ الحفظ يقصره عليها.
    setSelected(new Set(hasWildcard ? catalog : (role?.permissions ?? [])));
  }, [open, role, catalog, hasWildcard]);

  const toggle = (perm: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(perm) ? next.delete(perm) : next.add(perm);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.size === 0) { setError(t('select_permissions')); return; }
    setSaving(true);
    setError(null);
    const body = { name, permissions: [...selected] };
    try {
      if (role?.id) {
        await api(`/roles/${role.id}`, { method: 'PUT', body });
        success(tc('updated'));
      } else {
        await api('/roles', { method: 'POST', body });
        success(tc('created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const title = readOnly ? t('view_role') : role?.id ? t('edit_role') : t('add_role');

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="role_name">{t('role_name')}</Label>
          <Input id="role_name" value={name} onChange={(e) => setName(e.target.value)} required disabled={readOnly} />
        </div>

        {readOnly && (
          <p className="rounded bg-primary-soft px-3 py-2 text-xs text-primary">{t('owner_immutable')}</p>
        )}
        {!readOnly && role?.is_system && (
          <p className="rounded border border-border px-3 py-2 text-xs text-muted">{t('system_role_note')}</p>
        )}
        {!readOnly && hasWildcard && (
          <p className="rounded bg-warning/10 px-3 py-2 text-xs text-warning">{t('wildcard_downgrade_note')}</p>
        )}

        <div className="space-y-1.5">
          <Label>{t('select_permissions')}</Label>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded border border-border p-2">
            {modules.map(([mod, actions]) => (
              <div key={mod} className="flex items-center justify-between gap-3 rounded px-2 py-1.5 hover:bg-background">
                <span className="text-sm text-text">{modLabels[mod] ?? mod}</span>
                <div className="flex gap-2">
                  {actions.map((action) => {
                    const perm = `${mod}.${action}`;
                    const active = selected.has(perm);
                    return (
                      <button
                        key={perm}
                        type="button"
                        aria-pressed={active}
                        disabled={readOnly}
                        onClick={() => toggle(perm)}
                        className={cn(
                          'rounded border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60',
                          active ? 'border-primary bg-primary-soft font-medium text-primary' : 'border-border bg-surface text-muted hover:bg-background'
                        )}
                      >
                        {t(action === 'manage' ? 'perm_manage' : 'perm_view')}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>{readOnly ? t('close') : t('cancel')}</Button>
          {!readOnly && <Button type="submit" disabled={saving}>{t('save')}</Button>}
        </div>
      </form>
    </Dialog>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { platformApi } from '@/lib/platform-api';

type Assignment = { id: string; source_type: string; status: string; lifecycle_state: string; starts_at: string | null; ends_at: string | null; plan_version_id: string | null; product_version_id: string | null };
type Inspection = { effective_access: { level: string; reason: string }; commercial_sources: Array<{ source_type: string; access_mode: string; source_reference_id: string; lifecycle_access: string | null }>; tenant_application_state: { status: string }; dependencies: Array<{ capability_key: string; effective_access: string }>; rbac: { evaluated: boolean; reason: string } };

export function CommercialOperationsCard({ tenantId }: { tenantId: string }) {
  const t = useTranslations('platformTenants');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [capability, setCapability] = useState('hr.employees');
  const [operation, setOperation] = useState('read');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadHistory() {
    setLoading(true); setError(null);
    try { setAssignments((await platformApi<{ data: Assignment[] }>(`/platform/tenants/${tenantId}/commercial-assignments`)).data); }
    catch { setError(t('commercialLoadFailed')); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadHistory(); }, [tenantId]);
  async function inspect() {
    setLoading(true); setError(null);
    try { setInspection((await platformApi<{ data: Inspection }>(`/platform/tenants/${tenantId}/commercial-access/${encodeURIComponent(capability)}?operation=${operation}`)).data); }
    catch { setError(t('commercialLoadFailed')); }
    finally { setLoading(false); }
  }

  return <Card>
    <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{t('commercialOperations')}</CardTitle><Button size="sm" variant="outline" onClick={loadHistory} disabled={loading}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button></CardHeader>
    <CardContent className="space-y-5">
      {error && <p className="text-sm text-negative" role="alert">{error}</p>}
      <div><p className="text-sm text-muted">{t('commercialHistory')}</p>{assignments.length === 0 ? <p className="mt-2 text-sm text-muted">{t('noCommercialHistory')}</p> : <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b border-border text-start text-xs text-muted"><tr><th className="py-2 font-medium">{t('commercialSource')}</th><th className="py-2 font-medium">{t('commercialLifecycle')}</th><th className="py-2 font-medium">{t('startsOn')}</th><th className="py-2 font-medium">{t('endsOn')}</th></tr></thead><tbody>{assignments.map((item) => <tr key={item.id} className="border-b border-border last:border-0"><td className="py-2"><Badge tone="neutral">{item.source_type}</Badge></td><td className="py-2"><Badge tone={item.status === 'active' ? 'positive' : 'muted'}>{item.lifecycle_state}</Badge></td><td className="py-2 text-muted">{item.starts_at ?? '—'}</td><td className="py-2 text-muted">{item.ends_at ?? '—'}</td></tr>)}</tbody></table></div>}</div>
      <div className="border-t border-border pt-4"><p className="text-sm font-medium text-text">{t('accessInspector')}</p><p className="mt-1 text-xs text-muted">{t('accessInspectorNotice')}</p><div className="mt-3 flex flex-wrap items-end gap-2"><div><label className="mb-1 block text-xs text-muted">{t('capabilityKey')}</label><Input value={capability} onChange={(event) => setCapability(event.target.value)} className="w-52" /></div><div><label className="mb-1 block text-xs text-muted">{t('operationClass')}</label><Select value={operation} onChange={(event) => setOperation(event.target.value)} className="w-36">{['read','write','transition','destructive','export'].map((item) => <option key={item} value={item}>{item}</option>)}</Select></div><Button onClick={inspect} disabled={loading || !capability.trim()}><Search className="h-4 w-4" strokeWidth={1.7} />{t('inspectAccess')}</Button></div>{inspection && <div className="mt-4 rounded-md border border-border p-3 text-sm"><div className="flex flex-wrap gap-2"><Badge tone={inspection.effective_access.level === 'allowed' ? 'positive' : inspection.effective_access.level === 'read_only' ? 'warning' : 'negative'}>{inspection.effective_access.level}</Badge><span className="text-muted">{inspection.effective_access.reason}</span></div><dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"><div><dt className="text-muted">{t('commercialSources')}</dt><dd className="mt-1 text-text">{inspection.commercial_sources.map((source) => `${source.source_type}:${source.access_mode}`).join(', ') || '—'}</dd></div><div><dt className="text-muted">{t('applicationState')}</dt><dd className="mt-1 text-text">{inspection.tenant_application_state.status}</dd></div><div><dt className="text-muted">{t('dependenciesLabel')}</dt><dd className="mt-1 text-text">{inspection.dependencies.map((dependency) => `${dependency.capability_key}:${dependency.effective_access}`).join(', ') || '—'}</dd></div><div><dt className="text-muted">{t('rbacLabel')}</dt><dd className="mt-1 text-text">{inspection.rbac.reason}</dd></div></dl></div>}</div>
    </CardContent>
  </Card>;
}

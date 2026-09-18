'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Globe as GlobeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { AddCustomDomainDialog } from '@/modules/commerce-workspace/add-domain-dialog';
import {
  activateCommerceDomainEdge,
  canActivateDomainEdge,
  canDisconnectDomain,
  canMakeDomainPrimary,
  canRefreshDomainEdge,
  disconnectCommerceCustomDomain,
  edgeRefreshKind,
  fetchCommerceStorefrontDomains,
  makeCommerceDomainPrimary,
  refreshCommerceDomainEdge,
  verifyCommerceCustomDomain,
  type CommerceStoreDomain,
  type CommerceStoreDomainCatalog,
  type CommerceStoreDomainDnsRecord,
} from '@/modules/commerce-workspace/domains';

/**
 * STORE-ADMIN-ADOPT-1B-2 — شاشة «النطاقات»: قراءة نطاقات المتجر الحالي.
 * STORE-ADMIN-ADOPT-1B-3A — إضافة نطاق مخصَّص + تحقّق ملكية TXT.
 * STORE-ADMIN-ADOPT-1B-3B — Make Primary لنطاق AWJ مؤهل فقط، وDisconnect لمخصَّص.
 * CUSTOM-DOMAIN-EDGE-2 — تفعيل الحافة / تعليمات DNS / تحقّق HTTPS من سلطة
 * `edge` الخادمية. نطاق مخصَّص جاهز HTTPS لا يُعرض له Make Primary.
 */
export default function CommerceDomainsPage() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, selectedStoreId } = useCommerceStoreContext();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [domainCatalog, setDomainCatalog] = useState<CommerceStoreDomainCatalog>({ status: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [makingPrimaryId, setMakingPrimaryId] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<CommerceStoreDomain | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');

  function reload() {
    if (!selectedStoreId) return;
    setDomainCatalog({ status: 'loading' });
    fetchCommerceStorefrontDomains(selectedStoreId).then(setDomainCatalog);
  }

  function replaceDomain(domain: CommerceStoreDomain) {
    setDomainCatalog((prev) => {
      if (prev.status !== 'ready') return prev;
      return {
        status: 'ready',
        domains: prev.domains.map((row) => (row.id === domain.id ? domain : row)),
      };
    });
  }

  useEffect(() => {
    if (!selectedStoreId) return;
    let cancelled = false;
    setDomainCatalog({ status: 'loading' });
    fetchCommerceStorefrontDomains(selectedStoreId).then((result) => {
      if (!cancelled) setDomainCatalog(result);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedStoreId]);

  async function handleVerify(domain: CommerceStoreDomain) {
    if (!selectedStoreId || verifyingId) return;
    setVerifyingId(domain.id);
    try {
      const result = await verifyCommerceCustomDomain(selectedStoreId, domain.id);
      if (!result.ok) {
        showErrorToast(verifyErrorMessage(result.reason, t));
        return;
      }
      if (result.domain.verificationStatus === 'verified') {
        showSuccessToast(t('domainsVerificationVerified'));
      }
      reload();
    } finally {
      setVerifyingId(null);
    }
  }

  async function handleMakePrimary(domain: CommerceStoreDomain) {
    if (!selectedStoreId || makingPrimaryId) return;
    setMakingPrimaryId(domain.id);
    try {
      const result = await makeCommerceDomainPrimary(selectedStoreId, domain.id);
      if (!result.ok) {
        showErrorToast(makePrimaryErrorMessage(result.reason, t));
        return;
      }
      showSuccessToast(t('makePrimarySuccess'));
      reload();
    } finally {
      setMakingPrimaryId(null);
    }
  }

  async function handleActivate(domain: CommerceStoreDomain) {
    if (!selectedStoreId || activatingId) return;
    setActivatingId(domain.id);
    try {
      const result = await activateCommerceDomainEdge(selectedStoreId, domain.id);
      if (!result.ok) {
        showErrorToast(activateErrorMessage(result.reason, t));
        return;
      }
      showSuccessToast(t('activateDomainSuccess'));
      replaceDomain(result.domain);
    } finally {
      setActivatingId(null);
    }
  }

  async function handleRefresh(domain: CommerceStoreDomain) {
    if (!selectedStoreId || refreshingId) return;
    setRefreshingId(domain.id);
    try {
      const result = await refreshCommerceDomainEdge(selectedStoreId, domain.id);
      if (!result.ok) {
        showErrorToast(refreshErrorMessage(result.reason, t));
        return;
      }
      replaceDomain(result.domain);
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleDisconnectConfirm() {
    if (!selectedStoreId || !disconnectTarget || disconnecting) return;
    const targetId = disconnectTarget.id;
    setDisconnecting(true);
    try {
      const result = await disconnectCommerceCustomDomain(selectedStoreId, targetId);
      if (!result.ok) {
        showErrorToast(disconnectErrorMessage(result.reason, t));
        return;
      }
      setDisconnectTarget(null);
      showSuccessToast(t('disconnectSuccess'));
      reload();
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('title')}
        title={t('domains')}
        actionsSlot={
          canManage && selectedStoreId ? (
            <Button type="button" onClick={() => setAddOpen(true)}>
              {t('addDomainAction')}
            </Button>
          ) : undefined
        }
      />

      {catalog.status === 'loading' ? <LoadingState variant="table" rows={3} /> : null}

      {catalog.status === 'error' || catalog.status === 'unavailable' ? (
        <ErrorState message={t('storeSelectorUnavailableHint')} />
      ) : null}

      {catalog.status === 'empty' ? (
        <EmptyState icon={GlobeIcon} title={t('noStoreYetTitle')} description={t('noStoreYetDescription')} />
      ) : null}

      {catalog.status === 'ready' && selectedStoreId ? (
        <DomainsPanel
          catalog={domainCatalog}
          t={t}
          canManage={canManage}
          verifyingId={verifyingId}
          makingPrimaryId={makingPrimaryId}
          activatingId={activatingId}
          refreshingId={refreshingId}
          onVerify={handleVerify}
          onMakePrimary={handleMakePrimary}
          onActivate={handleActivate}
          onRefresh={handleRefresh}
          onDisconnect={setDisconnectTarget}
        />
      ) : null}

      {addOpen && selectedStoreId ? (
        <AddCustomDomainDialog
          open
          storefrontId={selectedStoreId}
          locale={locale}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            reload();
            showSuccessToast(t('addDomainSuccess'));
          }}
        />
      ) : null}

      {disconnectTarget ? (
        <DisconnectConfirmDialog
          domain={disconnectTarget}
          t={t}
          busy={disconnecting}
          onClose={() => {
            if (!disconnecting) setDisconnectTarget(null);
          }}
          onConfirm={() => void handleDisconnectConfirm()}
        />
      ) : null}
    </div>
  );
}

function verifyErrorMessage(
  reason: 'not_eligible' | 'dns_operational_error' | 'forbidden' | 'not_found' | 'failed',
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  switch (reason) {
    case 'not_eligible':
      return t('verifyNowNotEligible');
    case 'dns_operational_error':
      return t('verifyNowOperationalError');
    default:
      return t('verifyNowFailed');
  }
}

function makePrimaryErrorMessage(
  reason: 'not_ready' | 'not_eligible' | 'forbidden' | 'not_found' | 'failed',
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  switch (reason) {
    case 'not_ready':
      return t('makePrimaryNotReady');
    case 'not_eligible':
      return t('makePrimaryNotEligible');
    default:
      return t('makePrimaryFailed');
  }
}

function activateErrorMessage(
  reason: 'not_eligible' | 'conflict' | 'unavailable' | 'forbidden' | 'not_found' | 'failed',
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  switch (reason) {
    case 'not_eligible':
      return t('activateDomainNotEligible');
    case 'conflict':
      return t('activateDomainConflict');
    case 'unavailable':
      return t('activateDomainUnavailable');
    default:
      return t('activateDomainFailed');
  }
}

function refreshErrorMessage(
  reason: 'not_activated' | 'unavailable' | 'forbidden' | 'not_found' | 'failed',
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  switch (reason) {
    case 'not_activated':
      return t('refreshEdgeNotActivated');
    case 'unavailable':
      return t('refreshEdgeUnavailable');
    default:
      return t('refreshEdgeFailed');
  }
}

function disconnectErrorMessage(
  reason: 'managed' | 'primary' | 'forbidden' | 'not_found' | 'failed',
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  switch (reason) {
    case 'managed':
      return t('disconnectManagedForbidden');
    case 'primary':
      return t('disconnectPrimaryForbidden');
    default:
      return t('disconnectFailed');
  }
}

function DomainsPanel({
  catalog,
  t,
  canManage,
  verifyingId,
  makingPrimaryId,
  activatingId,
  refreshingId,
  onVerify,
  onMakePrimary,
  onActivate,
  onRefresh,
  onDisconnect,
}: {
  catalog: CommerceStoreDomainCatalog;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  canManage: boolean;
  verifyingId: string | null;
  makingPrimaryId: string | null;
  activatingId: string | null;
  refreshingId: string | null;
  onVerify: (domain: CommerceStoreDomain) => void;
  onMakePrimary: (domain: CommerceStoreDomain) => void;
  onActivate: (domain: CommerceStoreDomain) => void;
  onRefresh: (domain: CommerceStoreDomain) => void;
  onDisconnect: (domain: CommerceStoreDomain) => void;
}) {
  if (catalog.status === 'loading') {
    return <LoadingState variant="table" rows={3} />;
  }

  if (catalog.status === 'error') {
    return <ErrorState message={t('domainsLoadFailed')} />;
  }

  if (catalog.status === 'empty') {
    return (
      <EmptyState
        icon={GlobeIcon}
        title={t('domainsNoneYetTitle')}
        description={t('domainsNoneYetDescription')}
      />
    );
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH>{t('domainsListHostname')}</TH>
          <TH>{t('domainsListType')}</TH>
          <TH>{t('domainsListPrimary')}</TH>
          <TH>{t('domainsListStatus')}</TH>
          <TH>{t('domainsListVerification')}</TH>
          {canManage ? <TH>{t('storesListActions')}</TH> : null}
        </TR>
      </THead>
      <TBody>
        {catalog.domains.map((domain) => (
          <DomainRow
            key={domain.id}
            domain={domain}
            t={t}
            canManage={canManage}
            verifying={verifyingId === domain.id}
            makingPrimary={makingPrimaryId === domain.id}
            activating={activatingId === domain.id}
            refreshing={refreshingId === domain.id}
            onVerify={onVerify}
            onMakePrimary={onMakePrimary}
            onActivate={onActivate}
            onRefresh={onRefresh}
            onDisconnect={onDisconnect}
          />
        ))}
      </TBody>
    </Table>
  );
}

function DomainRow({
  domain,
  t,
  canManage,
  verifying,
  makingPrimary,
  activating,
  refreshing,
  onVerify,
  onMakePrimary,
  onActivate,
  onRefresh,
  onDisconnect,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  canManage: boolean;
  verifying: boolean;
  makingPrimary: boolean;
  activating: boolean;
  refreshing: boolean;
  onVerify: (domain: CommerceStoreDomain) => void;
  onMakePrimary: (domain: CommerceStoreDomain) => void;
  onActivate: (domain: CommerceStoreDomain) => void;
  onRefresh: (domain: CommerceStoreDomain) => void;
  onDisconnect: (domain: CommerceStoreDomain) => void;
}) {
  const showVerifyNow = canManage && domain.type === 'custom' && domain.verificationStatus !== 'verified';
  const showMakePrimary = canManage && canMakeDomainPrimary(domain);
  const showActivate = canManage && canActivateDomainEdge(domain);
  const showRefresh = canManage && canRefreshDomainEdge(domain);
  const showDisconnect = canManage && canDisconnectDomain(domain);
  const hasActions = showVerifyNow || showMakePrimary || showActivate || showRefresh || showDisconnect;
  const showOwnershipTxt = Boolean(domain.verification && domain.verificationStatus !== 'verified');
  const edgeRecords = domain.edge?.dnsInstructions.records ?? [];
  const showEdgeDns = domain.type === 'custom' && domain.verificationStatus === 'verified' && edgeRecords.length > 0;
  const showEdgeError = domain.type === 'custom' && domain.edge?.status === 'failed' && Boolean(domain.edge.lastError);

  return (
    <>
      <TR>
        <TD className="font-medium text-text" dir="ltr">
          {domain.hostname}
        </TD>
        <TD>
          <Badge tone="neutral">{domain.type === 'awj_subdomain' ? t('domainsTypeAwj') : t('domainsTypeCustom')}</Badge>
        </TD>
        <TD>
          {domain.isPrimary ? (
            <Badge tone="positive">{t('domainsListPrimary')}</Badge>
          ) : (
            <span className="text-muted">—</span>
          )}
        </TD>
        <TD>
          <Badge tone={domain.isActive ? 'positive' : 'muted'}>
            {domain.isActive ? t('storesListActive') : t('storesListInactive')}
          </Badge>
        </TD>
        <TD>
          <VerificationStatus domain={domain} t={t} />
        </TD>
        {canManage ? (
          <TD>
            {hasActions ? (
              <div className="flex flex-wrap items-center gap-2">
                {showMakePrimary ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={makingPrimary}
                    onClick={() => onMakePrimary(domain)}
                  >
                    {makingPrimary ? t('makePrimarySaving') : t('makePrimaryAction')}
                  </Button>
                ) : null}
                {showActivate ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={activating}
                    onClick={() => onActivate(domain)}
                  >
                    {activating ? t('activateDomainActivating') : t('activateDomainAction')}
                  </Button>
                ) : null}
                {showRefresh ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={refreshing}
                    onClick={() => onRefresh(domain)}
                  >
                    {refreshing ? t('refreshEdgeChecking') : refreshButtonLabel(domain, t)}
                  </Button>
                ) : null}
                {showVerifyNow ? (
                  <Button type="button" variant="outline" size="sm" disabled={verifying} onClick={() => onVerify(domain)}>
                    {verifying ? t('verifyNowChecking') : t('verifyNowAction')}
                  </Button>
                ) : null}
                {showDisconnect ? (
                  <Button type="button" variant="danger" size="sm" onClick={() => onDisconnect(domain)}>
                    {t('disconnectAction')}
                  </Button>
                ) : null}
              </div>
            ) : (
              <span className="text-muted">—</span>
            )}
          </TD>
        ) : null}
      </TR>
      {showOwnershipTxt && domain.verification ? (
        <TR>
          <TD colSpan={canManage ? 6 : 5} className="bg-muted/30">
            <OwnershipTxtInstructions verification={domain.verification} t={t} />
          </TD>
        </TR>
      ) : null}
      {showEdgeDns || showEdgeError ? (
        <TR>
          <TD colSpan={canManage ? 6 : 5} className="bg-muted/30">
            <EdgeInstructions
              records={edgeRecords}
              lastError={showEdgeError ? domain.edge?.lastError ?? null : null}
              t={t}
            />
          </TD>
        </TR>
      ) : null}
    </>
  );
}

function refreshButtonLabel(
  domain: CommerceStoreDomain,
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  const kind = edgeRefreshKind(domain);
  if (kind === 'dns') return t('refreshEdgeActionDns');
  if (kind === 'https') return t('refreshEdgeActionHttps');
  return t('refreshEdgeRetry');
}

function VerificationStatus({
  domain,
  t,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  if (domain.type !== 'custom') {
    return <Badge tone={verificationTone(domain.verificationStatus)}>{verificationLabel(domain.verificationStatus, t)}</Badge>;
  }

  if (domain.verificationStatus !== 'verified') {
    return <Badge tone={verificationTone(domain.verificationStatus)}>{verificationLabel(domain.verificationStatus, t)}</Badge>;
  }

  const status = domain.edge?.status ?? 'none';
  return (
    <div className="flex flex-col gap-1">
      <Badge tone="positive">{t('domainsOwnershipVerified')}</Badge>
      <EdgeStatusBadge status={status} readyAt={domain.edge?.readyAt ?? null} t={t} />
    </div>
  );
}

function EdgeStatusBadge({
  status,
  readyAt,
  t,
}: {
  status: NonNullable<CommerceStoreDomain['edge']>['status'];
  readyAt: string | null;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  if (status === 'ready') {
    return (
      <div className="flex flex-col gap-0.5">
        <Badge tone="positive">{t('edgeStatusReady')}</Badge>
        {readyAt ? (
          <span className="text-[11px] text-muted" dir="ltr">
            {t('edgeReadyAt')} {readyAt}
          </span>
        ) : null}
      </div>
    );
  }
  if (status === 'dns_required') return <Badge tone="warning">{t('edgeStatusDnsRequired')}</Badge>;
  if (status === 'tls_pending') return <Badge tone="warning">{t('edgeStatusTlsPending')}</Badge>;
  if (status === 'pending') return <Badge tone="muted">{t('edgeStatusPending')}</Badge>;
  if (status === 'failed') return <Badge tone="negative">{t('edgeStatusFailed')}</Badge>;
  return <Badge tone="warning">{t('domainsAwaitingActivation')}</Badge>;
}

function DisconnectConfirmDialog({
  domain,
  t,
  busy,
  onClose,
  onConfirm,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title={t('disconnectTitle')} className="max-w-md">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-text">{t('disconnectConfirm')}</p>
        <p dir="ltr" className="rounded border border-border bg-background px-3 py-2 font-mono text-xs text-muted">
          {domain.hostname}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {t('storeSettingsCancel')}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? t('disconnectDisconnecting') : t('disconnectConfirmAction')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function OwnershipTxtInstructions({
  verification,
  t,
}: {
  verification: NonNullable<CommerceStoreDomain['verification']>;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  return (
    <div className="space-y-1.5 py-2 text-xs">
      <p className="font-medium text-text">{t('ownershipTxtTitle')}</p>
      <DnsRecordList
        records={[{ type: 'TXT', name: verification.recordName, value: verification.recordValue }]}
        t={t}
      />
      <p className="text-muted">{t('ownershipTxtHint')}</p>
    </div>
  );
}

function EdgeInstructions({
  records,
  lastError,
  t,
}: {
  records: CommerceStoreDomainDnsRecord[];
  lastError: string | null;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  return (
    <div className="space-y-1.5 py-2 text-xs">
      {records.length > 0 ? (
        <>
          <p className="font-medium text-text">{t('edgeDnsTitle')}</p>
          <DnsRecordList records={records} t={t} />
          <p className="text-muted">{t('edgeDnsHint')}</p>
        </>
      ) : null}
      {lastError ? (
        <p className="rounded bg-negative/10 px-3 py-2 text-negative" role="alert">
          {lastError}
        </p>
      ) : null}
    </div>
  );
}

function DnsRecordList({
  records,
  t,
}: {
  records: CommerceStoreDomainDnsRecord[];
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  return (
    <ul className="space-y-2">
      {records.map((record, index) => (
        <li
          key={`${record.type}:${record.name}:${record.value}:${index}`}
          className="rounded border border-border bg-background px-3 py-2"
          dir="ltr"
        >
          <dl className="grid grid-cols-1 gap-1 sm:grid-cols-[auto_1fr_auto] sm:items-start sm:gap-x-3">
            <dt className="text-muted">{t('dnsInstructionsType')}</dt>
            <dd className="font-mono sm:col-span-2">{record.type}</dd>
            <dt className="text-muted">{t('dnsInstructionsName')}</dt>
            <dd className="break-all font-mono">{record.name}</dd>
            <dd>
              <CopyValueButton label={t('copyNameAction')} copiedLabel={t('copiedAction')} value={record.name} />
            </dd>
            <dt className="text-muted">{t('dnsInstructionsValue')}</dt>
            <dd className="break-all font-mono">{record.value}</dd>
            <dd>
              <CopyValueButton label={t('copyValueAction')} copiedLabel={t('copiedAction')} value={record.value} />
            </dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function CopyValueButton({
  label,
  copiedLabel,
  value,
}: {
  label: string;
  copiedLabel: string;
  value: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => void copy()} aria-label={label}>
      {copied ? copiedLabel : label}
    </Button>
  );
}

function verificationTone(status: CommerceStoreDomain['verificationStatus']): 'positive' | 'warning' | 'negative' {
  if (status === 'verified') return 'positive';
  if (status === 'failed') return 'negative';
  return 'warning';
}

function verificationLabel(
  status: CommerceStoreDomain['verificationStatus'],
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string,
): string {
  if (status === 'verified') return t('domainsVerificationVerified');
  if (status === 'failed') return t('domainsVerificationFailed');
  return t('domainsVerificationPending');
}

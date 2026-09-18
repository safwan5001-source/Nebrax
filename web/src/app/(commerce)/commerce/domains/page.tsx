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
  canDisconnectDomain,
  canMakeDomainPrimary,
  disconnectCommerceCustomDomain,
  fetchCommerceStorefrontDomains,
  makeCommerceDomainPrimary,
  verifyCommerceCustomDomain,
  type CommerceStoreDomain,
  type CommerceStoreDomainCatalog,
} from '@/modules/commerce-workspace/domains';

/**
 * STORE-ADMIN-ADOPT-1B-2 — شاشة «النطاقات»: قراءة نطاقات المتجر الحالي
 * (المُختار في `CommerceStoreProvider`). لا مُحدِّد متجر خاص بهذه الشاشة؛
 * المتجر المُختار مصدره السياق الموثوق وحده.
 *
 * STORE-ADMIN-ADOPT-1B-3A — يضيف فعلَين محروسَين بـ`commerce.manage` فقط:
 * «إضافة نطاق مخصَّص» و«تحقّق الآن».
 *
 * STORE-ADMIN-ADOPT-1B-3B — يضيف Make Primary فقط حين تسمح دلالات الخادم
 * (نطاق AWJ مؤهل)، وDisconnect لنطاق مخصَّص مع حوار تأكيد. نطاق مخصَّص
 * مُتحقَّق الملكية لا يُعرض كجاهز ولا يُتاح جعله أساسياً — لا دليل Edge/TLS.
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
  const [disconnectTarget, setDisconnectTarget] = useState<CommerceStoreDomain | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'commerce.manage');

  function reload() {
    if (!selectedStoreId) return;
    setDomainCatalog({ status: 'loading' });
    fetchCommerceStorefrontDomains(selectedStoreId).then(setDomainCatalog);
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
          onVerify={handleVerify}
          onMakePrimary={handleMakePrimary}
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
  onVerify,
  onMakePrimary,
  onDisconnect,
}: {
  catalog: CommerceStoreDomainCatalog;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  canManage: boolean;
  verifyingId: string | null;
  makingPrimaryId: string | null;
  onVerify: (domain: CommerceStoreDomain) => void;
  onMakePrimary: (domain: CommerceStoreDomain) => void;
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
            onVerify={onVerify}
            onMakePrimary={onMakePrimary}
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
  onVerify,
  onMakePrimary,
  onDisconnect,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  canManage: boolean;
  verifying: boolean;
  makingPrimary: boolean;
  onVerify: (domain: CommerceStoreDomain) => void;
  onMakePrimary: (domain: CommerceStoreDomain) => void;
  onDisconnect: (domain: CommerceStoreDomain) => void;
}) {
  const showVerifyNow = canManage && domain.type === 'custom' && domain.verificationStatus !== 'verified';
  const showMakePrimary = canManage && canMakeDomainPrimary(domain);
  const showDisconnect = canManage && canDisconnectDomain(domain);
  const hasActions = showVerifyNow || showMakePrimary || showDisconnect;

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
      {domain.verification && domain.verificationStatus !== 'verified' ? (
        <TR>
          <TD colSpan={canManage ? 6 : 5} className="bg-muted/30">
            <DnsInstructions verification={domain.verification} t={t} />
          </TD>
        </TR>
      ) : null}
    </>
  );
}

function VerificationStatus({
  domain,
  t,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  if (domain.type === 'custom' && domain.verificationStatus === 'verified') {
    return (
      <div className="flex flex-col gap-1">
        <Badge tone="positive">{t('domainsOwnershipVerified')}</Badge>
        <Badge tone="warning">{t('domainsAwaitingActivation')}</Badge>
      </div>
    );
  }

  return <Badge tone={verificationTone(domain.verificationStatus)}>{verificationLabel(domain.verificationStatus, t)}</Badge>;
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

function DnsInstructions({
  verification,
  t,
}: {
  verification: NonNullable<CommerceStoreDomain['verification']>;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  return (
    <div className="space-y-1.5 py-2 text-xs" dir="ltr">
      <p className="font-medium text-text">{t('dnsInstructionsTitle')}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted">{t('dnsInstructionsType')}</dt>
        <dd className="font-mono">TXT</dd>
        <dt className="text-muted">{t('dnsInstructionsName')}</dt>
        <dd className="break-all font-mono">{verification.recordName}</dd>
        <dt className="text-muted">{t('dnsInstructionsValue')}</dt>
        <dd className="break-all font-mono">{verification.recordValue}</dd>
      </dl>
      <p className="text-muted">{t('dnsInstructionsHint')}</p>
    </div>
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

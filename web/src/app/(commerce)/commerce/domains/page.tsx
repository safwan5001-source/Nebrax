'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Globe as GlobeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { AddCustomDomainDialog } from '@/modules/commerce-workspace/add-domain-dialog';
import {
  fetchCommerceStorefrontDomains,
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
 * «إضافة نطاق مخصَّص» (حوار Hostname فقط) و«تحقّق الآن» لكل نطاق مخصَّص غير
 * مُتحقَّق (يشغّل تحقّق DNS TXT فعلي على الخادم — لا تفاؤل محلي). لا Make
 * Primary، لا حذف/إيقاف، لا إعادة توليد challenge — تلك 1B-3B أو خارج النطاق
 * صراحةً.
 */
export default function CommerceDomainsPage() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, selectedStoreId } = useCommerceStoreContext();
  const { error: showErrorToast, success: showSuccessToast } = useToast();
  const [domainCatalog, setDomainCatalog] = useState<CommerceStoreDomainCatalog>({ status: 'loading' });
  const [addOpen, setAddOpen] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

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
        <DomainsPanel catalog={domainCatalog} t={t} canManage={canManage} verifyingId={verifyingId} onVerify={handleVerify} />
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

function DomainsPanel({
  catalog,
  t,
  canManage,
  verifyingId,
  onVerify,
}: {
  catalog: CommerceStoreDomainCatalog;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  canManage: boolean;
  verifyingId: string | null;
  onVerify: (domain: CommerceStoreDomain) => void;
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
          <DomainRow key={domain.id} domain={domain} t={t} canManage={canManage} verifying={verifyingId === domain.id} onVerify={onVerify} />
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
  onVerify,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
  canManage: boolean;
  verifying: boolean;
  onVerify: (domain: CommerceStoreDomain) => void;
}) {
  const canVerifyNow = canManage && domain.type === 'custom' && domain.verificationStatus !== 'verified';

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
          <Badge tone={verificationTone(domain.verificationStatus)}>{verificationLabel(domain.verificationStatus, t)}</Badge>
        </TD>
        {canManage ? (
          <TD>
            {canVerifyNow ? (
              <Button type="button" variant="outline" size="sm" disabled={verifying} onClick={() => onVerify(domain)}>
                {verifying ? t('verifyNowChecking') : t('verifyNowAction')}
              </Button>
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

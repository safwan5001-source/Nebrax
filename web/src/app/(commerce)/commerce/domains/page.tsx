'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { Globe as GlobeIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/nebrax';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import {
  fetchCommerceStorefrontDomains,
  type CommerceStoreDomain,
  type CommerceStoreDomainCatalog,
} from '@/modules/commerce-workspace/domains';

/**
 * STORE-ADMIN-ADOPT-1B-2 — شاشة «النطاقات»: قراءة فقط لنطاقات المتجر
 * الحالي (المُختار في `CommerceStoreProvider`)، بلا أي فعل إضافة/تحقق/حذف/
 * تعيين أساسي — تلك لاحقاً في 1B-3. لا مُحدِّد متجر خاص بهذه الشاشة؛
 * المتجر المُختار مصدره السياق الموثوق وحده.
 */
export default function CommerceDomainsPage() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog, selectedStoreId } = useCommerceStoreContext();
  const [domainCatalog, setDomainCatalog] = useState<CommerceStoreDomainCatalog>({ status: 'loading' });

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

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={t('title')} title={t('domains')} />

      {catalog.status === 'loading' ? <LoadingState variant="table" rows={3} /> : null}

      {catalog.status === 'error' || catalog.status === 'unavailable' ? (
        <ErrorState message={t('storeSelectorUnavailableHint')} />
      ) : null}

      {catalog.status === 'empty' ? (
        <EmptyState icon={GlobeIcon} title={t('noStoreYetTitle')} description={t('noStoreYetDescription')} />
      ) : null}

      {catalog.status === 'ready' && selectedStoreId ? (
        <DomainsPanel catalog={domainCatalog} t={t} />
      ) : null}
    </div>
  );
}

function DomainsPanel({
  catalog,
  t,
}: {
  catalog: CommerceStoreDomainCatalog;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
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
        </TR>
      </THead>
      <TBody>
        {catalog.domains.map((domain) => (
          <DomainRow key={domain.id} domain={domain} t={t} />
        ))}
      </TBody>
    </Table>
  );
}

function DomainRow({
  domain,
  t,
}: {
  domain: CommerceStoreDomain;
  t: (key: Parameters<typeof commerceWorkspaceMessage>[1]) => string;
}) {
  return (
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
    </TR>
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

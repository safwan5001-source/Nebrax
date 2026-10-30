'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Boxes, ShieldAlert, Store, Unplug } from 'lucide-react';
import { EmptyState, LoadingState, PageHeader, type PageAction } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { useCan } from '@/lib/use-can';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { useWholesaleChannel } from '../channel-context';
import type { WholesaleReadiness } from '../channel';
import { commonMessages } from '../messages/common';
import { WHOLESALE_BASE, wholesaleSection, type WholesaleSectionKey } from '../nav';

type GateReadiness = Exclude<WholesaleReadiness, 'loading' | 'active'>;

const GATE_ICON = {
  no_channel: Store,
  settings_unavailable: ShieldAlert,
  deployment_off: Unplug,
  channel_not_marked: Boxes,
} as const;

/** Honest gate for a data section whose channel precondition is not met. Never renders data. */
export function ReadinessGate({ readiness }: { readiness: GateReadiness }) {
  const locale = useLocale();
  const { t } = commonMessages.forLocale(locale);
  const { store } = useWholesaleChannel();
  const Icon = GATE_ICON[readiness];
  const settingsHref = withStoreParam(`${WHOLESALE_BASE}/settings`, store?.id ?? null);
  const showSettings = readiness === 'channel_not_marked';

  return (
    <EmptyState
      icon={Icon}
      title={t(`gate.${readiness}.title` as 'gate.no_channel.title')}
      description={t(`gate.${readiness}.body` as 'gate.no_channel.body')}
      action={
        showSettings ? (
          <Button asChild variant="outline">
            <Link href={settingsHref}>{t('gateGoSettings')}</Link>
          </Button>
        ) : readiness === 'deployment_off' ? (
          <Button asChild variant="outline">
            <Link href={withStoreParam(WHOLESALE_BASE, store?.id ?? null)}>{t('gateBackOverview')}</Link>
          </Button>
        ) : undefined
      }
    />
  );
}

/**
 * Page frame for one Wholesale section: header, permission gate (nothing is requested without the permission) and
 * the channel-readiness gate declared in `nav.ts`. Children are only mounted when both pass, so a section's data
 * hooks never fire for a viewer or channel that cannot use them.
 */
export function SectionPage({
  sectionKey,
  description,
  actions,
  actionsSlot,
  children,
}: {
  sectionKey: WholesaleSectionKey;
  description?: ReactNode;
  actions?: PageAction[];
  actionsSlot?: ReactNode;
  children: ReactNode;
}) {
  const locale = useLocale();
  const { t } = commonMessages.forLocale(locale);
  const section = wholesaleSection(sectionKey);
  const { can, hydrated } = useCan();
  const { readiness } = useWholesaleChannel();

  const header = (
    <PageHeader
      eyebrow={t('workspaceEyebrow')}
      title={t(`section.${sectionKey}` as 'section.overview')}
      description={description}
      actions={actions}
      actionsSlot={actionsSlot}
    />
  );

  let body: ReactNode;
  if (!hydrated) {
    // Before hydration the session is unknown: no permission verdict, no request (avoids a "denied" flash).
    body = <LoadingState variant="table" rows={4} label={t('loading')} />;
  } else if (section.permission && !can(section.permission)) {
    body = (
      <EmptyState
        icon={ShieldAlert}
        title={t('forbiddenTitle')}
        description={t('forbiddenBody', { permission: section.permission })}
      />
    );
  } else if (section.requires === 'channel' && readiness === 'no_channel') {
    body = <ReadinessGate readiness="no_channel" />;
  } else if (section.requires === 'wholesale_active') {
    if (readiness === 'loading') body = <LoadingState variant="table" rows={4} label={t('loading')} />;
    else if (readiness !== 'active') body = <ReadinessGate readiness={readiness} />;
    else body = children;
  } else {
    body = children;
  }

  return (
    <div className="space-y-4">
      {header}
      {body}
    </div>
  );
}

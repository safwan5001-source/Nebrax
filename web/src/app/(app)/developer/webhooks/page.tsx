'use client';

import { DeveloperGate, useDeveloperAccess } from '@/components/developer/developer-shell';
import { WebhooksWorkspace } from '@/components/developer/webhooks/webhooks-workspace';

export default function DeveloperWebhooksPage() {
  const access = useDeveloperAccess();
  return (
    <DeveloperGate access={access} demoGate>
      <WebhooksWorkspace canManage={access.canManage} />
    </DeveloperGate>
  );
}

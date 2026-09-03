'use client';

import { DeveloperGate, useDeveloperAccess } from '@/components/developer/developer-shell';
import { KeysWorkspace } from '@/components/developer/keys/keys-workspace';

export default function DeveloperKeysPage() {
  const access = useDeveloperAccess();
  return (
    <DeveloperGate access={access} demoGate>
      <KeysWorkspace canManage={access.canManage} />
    </DeveloperGate>
  );
}

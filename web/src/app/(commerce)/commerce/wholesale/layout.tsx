import type { ReactNode } from 'react';
import { WholesaleWorkspaceFrame } from '@/modules/commerce-workspace/wholesale/components/workspace-frame';

/** Wholesale Merchant Workspace — one frame (channel provider + section bar) for all `/commerce/wholesale/*` routes. */
export default function WholesaleLayout({ children }: { children: ReactNode }) {
  return <WholesaleWorkspaceFrame>{children}</WholesaleWorkspaceFrame>;
}

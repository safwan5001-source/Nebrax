'use client';

import type { ReactNode } from 'react';
import { WholesaleChannelProvider } from '../channel-context';
import { ChannelBar } from './channel-bar';
import { WholesaleSubnav } from './subnav';

/** Layout frame for every `/commerce/wholesale/*` route: channel provider + channel bar + section bar. */
export function WholesaleWorkspaceFrame({ children }: { children: ReactNode }) {
  return (
    <WholesaleChannelProvider>
      <div className="space-y-4">
        <ChannelBar />
        <WholesaleSubnav />
        {children}
      </div>
    </WholesaleChannelProvider>
  );
}

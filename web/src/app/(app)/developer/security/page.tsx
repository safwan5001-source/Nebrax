'use client';

import { useTranslations } from 'next-intl';
import {
  Fingerprint, Gauge, KeyRound, Layers, RefreshCw, Repeat, Reply, ShieldCheck, Signature, ListChecks, type LucideIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/nebrax';
import { CodeBlock } from '@/components/developer/code-block';
import { DeveloperGate, useDeveloperAccess } from '@/components/developer/developer-shell';

interface Item { icon: LucideIcon; title: string; body: string }

/** مثال تحقّق التوقيع — من الخوارزمية الموثّقة في العقد (سلوك مُتحقَّق، لا اختراع). */
const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, headers, secret, toleranceSec = 300) {
  const sig = headers["x-awj-signature"];            // "t=<unix>,v1=<hex>"
  const parts = Object.fromEntries(sig.split(",").map((p) => p.split("=")));
  const expected = createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");
  const ok = timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
  const fresh = Math.abs(Date.now() / 1000 - Number(parts.t)) <= toleranceSec;
  return ok && fresh;
}`;

export default function DeveloperSecurityPage() {
  const access = useDeveloperAccess();
  const t = useTranslations('developer.security');

  const credentials: Item[] = [
    { icon: KeyRound, title: t('bearerTitle'), body: t('bearerBody') },
    { icon: Layers, title: t('scopeTitle'), body: t('scopeBody') },
    { icon: ShieldCheck, title: t('oneTimeTitle'), body: t('oneTimeBody') },
    { icon: RefreshCw, title: t('rotateTitle'), body: t('rotateBody') },
  ];
  const requests: Item[] = [
    { icon: Repeat, title: t('idempotencyTitle'), body: t('idempotencyBody') },
    { icon: Fingerprint, title: t('requestIdTitle'), body: t('requestIdBody') },
    { icon: Gauge, title: t('rateLimitTitle'), body: t('rateLimitBody') },
  ];
  const webhooks: Item[] = [
    { icon: Signature, title: t('signatureTitle'), body: t('signatureBody') },
    { icon: ListChecks, title: t('dedupTitle'), body: t('dedupBody') },
    { icon: Reply, title: t('replyTitle'), body: t('replyBody') },
  ];

  const Group = ({ heading, items, children }: { heading: string; items: Item[]; children?: React.ReactNode }) => (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text">{heading}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="rounded border border-border bg-surface p-3.5">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
                <h3 className="text-sm font-medium text-text">{item.title}</h3>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted [unicode-bidi:plaintext]">{item.body}</p>
            </div>
          );
        })}
      </div>
      {children}
    </section>
  );

  return (
    <div className="space-y-8">
      <PageHeader title={t('title')} description={t('description')} />

      <DeveloperGate access={access}>
        <Group heading={t('groupCredentials')} items={credentials} />
        <Group heading={t('groupRequests')} items={requests} />
        <Group heading={t('groupWebhooks')} items={webhooks}>
          <CodeBlock label="JavaScript" code={VERIFY_SNIPPET} />
        </Group>
      </DeveloperGate>
    </div>
  );
}

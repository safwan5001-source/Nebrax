'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { BookText, KeyRound, ShieldCheck, Webhook } from 'lucide-react';
import { PageHeader } from '@/components/nebrax';
import { CodeBlock } from '@/components/developer/code-block';
import { DeveloperGate, useDeveloperAccess } from '@/components/developer/developer-shell';
import { OPENAPI_MODEL } from '@/modules/developer/docs/openapi-model.generated';
import { buildCurl } from '@/modules/developer/docs/examples';

/** أول طلب ناجح تمثيليّ: قائمة الأطراف (مصادَق، يُظهر ترويسة Bearer والمسار الحقيقي). */
const FIRST_REQUEST = OPENAPI_MODEL.tags
  .flatMap((tag) => tag.operations)
  .find((op) => op.id === 'listPartners');

export default function DeveloperOverviewPage() {
  const access = useDeveloperAccess();
  const t = useTranslations('developer.overview');
  const tw = useTranslations('developer');

  const shortcuts = [
    { href: '/developer/keys', icon: KeyRound, label: t('goKeys'), hint: t('goKeysHint') },
    { href: '/developer/docs', icon: BookText, label: t('goDocs'), hint: t('goDocsHint') },
    { href: '/developer/webhooks', icon: Webhook, label: t('goWebhooks'), hint: t('goWebhooksHint') },
    { href: '/developer/security', icon: ShieldCheck, label: t('goSecurity'), hint: t('goSecurityHint') },
  ];

  const steps = [
    { title: t('step1Title'), body: t('step1Body') },
    { title: t('step2Title'), body: t('step2Body') },
    { title: t('step3Title'), body: t('step3Body') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />

      <DeveloperGate access={access}>
        {/* شريط الهوية — مضغوط أفقيّ، لا بطاقات مؤشرات زخرفية (§43). */}
        <div className="grid gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-3">
          {[
            { label: t('versionLabel'), value: OPENAPI_MODEL.version, mono: true },
            { label: t('authLabel'), value: t('authValue'), mono: false },
            { label: t('baseLabel'), value: OPENAPI_MODEL.server.template, mono: true, hint: t('baseHint') },
          ].map((item) => (
            <div key={item.label} className="bg-surface p-3">
              <div className="text-xs text-muted">{item.label}</div>
              <div dir={item.mono ? 'ltr' : undefined} className={item.mono ? 'mt-0.5 font-mono text-sm text-text' : 'mt-0.5 text-sm text-text'}>
                {item.value}
              </div>
              {item.hint ? <div className="mt-0.5 text-[11px] text-muted">{item.hint}</div> : null}
            </div>
          ))}
        </div>

        {/* البدء السريع — ثلاث خطوات مرقّمة، لا بطاقات ضخمة. */}
        <section className="rounded border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">{t('quickStartTitle')}</h2>
          <ol className="mt-3 space-y-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text">{step.title}</div>
                  <p className="mt-0.5 text-sm text-muted">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* مثال أول طلب ناجح — من العقد. */}
        {FIRST_REQUEST ? (
          <section className="space-y-2">
            <div>
              <h2 className="text-sm font-semibold text-text">{t('exampleTitle')}</h2>
              <p className="mt-0.5 text-sm text-muted">{t('exampleHint')}</p>
            </div>
            <CodeBlock label="cURL" code={buildCurl(FIRST_REQUEST)} />
          </section>
        ) : null}

        {/* اختصارات التكامل — روابط مضغوطة لا زخرفة. */}
        <section className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className="flex items-start gap-3 rounded border border-border bg-surface p-3.5 transition-colors hover:border-primary/40 hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted" strokeWidth={1.7} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-text">{shortcut.label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{shortcut.hint}</span>
                </span>
              </Link>
            );
          })}
        </section>

        {/* ملاحظة شكل الاستجابة. */}
        <section className="rounded border border-border bg-surface p-4">
          <h2 className="text-sm font-semibold text-text">{t('envelopeTitle')}</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">{t('envelopeBody')}</p>
        </section>
      </DeveloperGate>
    </div>
  );
}

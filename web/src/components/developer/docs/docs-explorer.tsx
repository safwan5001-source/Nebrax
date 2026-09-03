'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { KeyRound, Repeat, ShieldCheck, Unlock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { TechnicalDetails } from '@/components/ui/technical-details';
import { MethodBadge } from '@/components/developer/method-badge';
import { CodeBlock } from '@/components/developer/code-block';
import { FieldTable } from '@/components/developer/field-table';
import { OPENAPI_MODEL } from '@/modules/developer/docs/openapi-model.generated';
import { buildExamples } from '@/modules/developer/docs/examples';
import type { ApiOperation, ApiParameter } from '@/modules/developer/docs/openapi-types';
import { cn } from '@/lib/utils';

const MODEL = OPENAPI_MODEL;
const ALL_OPS = MODEL.tags.flatMap((tag) => tag.operations);

/** توثيق ثلاثي المناطق مشتقّ من العقد: تصفّح الموارد · تفاصيل العمليّة · مثال الشيفرة. */
export function DocsExplorer() {
  const t = useTranslations('developer.docs');
  const [selectedId, setSelectedId] = useState<string>(ALL_OPS[0]?.id ?? '');
  const operation = useMemo(() => ALL_OPS.find((op) => op.id === selectedId) ?? ALL_OPS[0], [selectedId]);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* منطقة التصفّح — قائمة على الشاشات الواسعة، ومنتقٍ مضغوط على الجوال (§23). */}
      <nav className="lg:w-64 lg:shrink-0" aria-label={t('resourcesLabel')}>
        <div className="lg:hidden">
          <label className="mb-1 block text-xs font-medium text-muted">{t('selectOperation')}</label>
          <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} aria-label={t('selectOperation')}>
            {MODEL.tags.map((tag) => (
              <optgroup key={tag.name} label={tag.name}>
                {tag.operations.map((op) => (
                  <option key={op.id} value={op.id}>{`${op.method.toUpperCase()} ${op.path}`}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>

        <div className="hidden max-h-[calc(100dvh-11rem)] overflow-y-auto rounded border border-border bg-surface p-2 lg:block">
          {MODEL.tags.map((tag) => (
            <div key={tag.name} className="mb-2 last:mb-0">
              <div className="px-2 py-1 text-xs font-semibold text-muted">{tag.name}</div>
              <ul>
                {tag.operations.map((op) => {
                  const active = op.id === operation?.id;
                  return (
                    <li key={op.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(op.id)}
                        aria-current={active ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          active ? 'bg-primary-soft text-primary' : 'text-text hover:bg-primary-soft',
                        )}
                      >
                        <MethodBadge method={op.method.toUpperCase()} />
                        <span className="min-w-0 flex-1 truncate">{op.summary ?? op.id}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {/* المحتوى + الشيفرة: عمودان على xl، متراصّان دونها (تحويل ذكيّ لا سحق أفقي). */}
      {operation ? (
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-6 xl:flex-row">
            <div className="min-w-0 xl:flex-1">
              <OperationDetail operation={operation} />
            </div>
            <aside className="xl:w-[380px] xl:shrink-0">
              <div className="xl:sticky xl:top-4">
                <OperationExamples operation={operation} />
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetaRow({ operation }: { operation: ApiOperation }) {
  const t = useTranslations('developer.docs');
  return (
    <div className="flex flex-wrap items-center gap-2">
      {operation.scope ? (
        <Badge tone="neutral">
          <KeyRound className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          <span className="text-[11px] text-muted">{t('scopeRequired')}:</span>
          <code dir="ltr" className="font-mono text-[11px]">{operation.scope}</code>
        </Badge>
      ) : (
        <Badge tone="muted">
          <Unlock className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          {t('authNone')}
        </Badge>
      )}
      {operation.requiresAuth ? (
        <Badge tone="muted"><ShieldCheck className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />{t('authRequired')}</Badge>
      ) : null}
      {operation.idempotency ? (
        <Badge tone="warning" title={t('idempotencyHint')}>
          <Repeat className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
          {t('idempotencyRequired')}
        </Badge>
      ) : null}
    </div>
  );
}

function ParamTable({ title, params }: { title: string; params: ApiParameter[] }) {
  const t = useTranslations('developer.docs');
  if (params.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold text-muted">{title}</h4>
      <div className="divide-y divide-border overflow-hidden rounded border border-border">
        {params.map((param) => (
          <div key={`${param.in}-${param.name}`} className="px-3 py-2 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,2fr)] md:gap-3">
            <div className="min-w-0">
              <code dir="ltr" className="font-mono text-sm text-text">{param.name}</code>
              {param.required ? <span className="ms-1.5 text-[11px] text-negative">{t('fieldRequired')}</span> : null}
            </div>
            <code dir="ltr" className="mt-1 block font-mono text-xs text-muted md:mt-0">{param.type}</code>
            <div className="mt-1 min-w-0 md:mt-0">
              {param.description ? <p dir="auto" className="text-xs leading-relaxed text-text">{param.description}</p> : null}
              {param.constraints ? <p dir="ltr" className="mt-0.5 break-words font-mono text-[11px] text-muted/80">{param.constraints}</p> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OperationDetail({ operation }: { operation: ApiOperation }) {
  const t = useTranslations('developer.docs');
  const pathParams = operation.parameters.filter((param) => param.in === 'path');
  const queryParams = operation.parameters.filter((param) => param.in === 'query');
  const headerParams = operation.parameters.filter((param) => param.in === 'header');

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={operation.method.toUpperCase()} />
          <code dir="ltr" className="break-all font-mono text-sm text-text">{operation.path}</code>
        </div>
        {operation.summary ? <h3 dir="auto" className="text-base font-semibold text-text">{operation.summary}</h3> : null}
        <MetaRow operation={operation} />
        {/* نصّ العقد إنجليزيّ؛ dir="auto" يجعله يُقرأ LTR طبيعياً داخل قشرة RTL (§15). */}
        {operation.description ? <p dir="auto" className="text-sm leading-relaxed text-muted">{operation.description}</p> : null}
      </div>

      {/* المعاملات */}
      {operation.parameters.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-text">{t('parameters')}</h3>
          <ParamTable title={t('pathParams')} params={pathParams} />
          <ParamTable title={t('queryParams')} params={queryParams} />
          <ParamTable title={t('headerParams')} params={headerParams} />
        </section>
      ) : null}

      {/* جسم الطلب */}
      {operation.requestBody ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text">{t('requestBody')}</h3>
          <FieldTable fields={operation.requestBody.fields} schemas={MODEL.schemas} />
          {operation.requestBody.example != null ? (
            <TechnicalDetails
              title={t('rawExample')}
              data={operation.requestBody.example}
              copyLabel={t('fieldExample')}
            />
          ) : null}
        </section>
      ) : null}

      {/* الاستجابات */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text">{t('responses')}</h3>
        <div className="space-y-2">
          {operation.responses.map((response) => {
            const ok = response.status.startsWith('2');
            return (
              <div key={response.status} className="rounded border border-border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Badge tone={ok ? 'positive' : 'muted'}><span className="num">{response.status}</span></Badge>
                  <span dir="auto" className="min-w-0 flex-1 text-xs text-muted">{response.description}</span>
                </div>
                {ok && response.data ? (
                  <div className="border-t border-border p-3">
                    <p className="mb-2 text-xs font-medium text-muted">
                      {response.data.kind === 'list'
                        ? t('responseList', { type: response.data.itemType })
                        : t('responseObject', { type: response.data.itemType })}
                    </p>
                    <FieldTable fields={response.data.fields} schemas={MODEL.schemas} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function OperationExamples({ operation }: { operation: ApiOperation }) {
  const t = useTranslations('developer.docs');
  const examples = useMemo(() => buildExamples(operation), [operation]);
  const [lang, setLang] = useState(examples[0]?.language ?? 'bash');
  const active = examples.find((example) => example.language === lang) ?? examples[0];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{t('exampleTitle')}</h3>
        <div className="inline-flex rounded border border-border p-0.5" role="group">
          {examples.map((example) => (
            <button
              key={example.language}
              type="button"
              onClick={() => setLang(example.language)}
              aria-pressed={example.language === lang}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                example.language === lang ? 'bg-primary-soft text-primary' : 'text-muted hover:text-text',
              )}
            >
              {example.label}
            </button>
          ))}
        </div>
      </div>
      {active ? <CodeBlock label={active.label} code={active.code} /> : null}
    </div>
  );
}

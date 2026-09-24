'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import {
  type AppSchemaComponent, type AppBuilderRegistries, type RegistryPropDefinition, type RegistryActionParamDefinition,
} from '@/lib/app-builder';

/**
 * APP-BUILDER-5 — لوحة خصائص **للقراءة فقط**. المصدر `ComponentRegistry`/`ActionRegistry`
 * (APP-BUILDER-3) عبر `GET /app-builder/registries` (AB-05: Inspector مدفوعٌ بالبيانات
 * الوصفية، لا نموذج مُقفَل لكل مكوّن). التحرير الفعلي APP-BUILDER-6 — هذه اللوحة تعرض
 * القيمة الحالية بجانب نوعها وإلزاميّتها، ولا تعرض حقل إدخال واحداً.
 */

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join('، ');
  return String(value);
}

function PropRow({ definition, currentValue }: { definition: RegistryPropDefinition; currentValue: unknown }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text">{definition.key}</p>
        <p className="text-[11px] text-muted">
          {definition.type}
          {definition.required ? ' · مطلوب' : ''}
        </p>
      </div>
      <span className="num max-w-[45%] shrink-0 truncate text-end text-xs text-text">{displayValue(currentValue)}</span>
    </div>
  );
}

function ActionParamRow({ definition, currentValue }: { definition: RegistryActionParamDefinition; currentValue: unknown }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-text">{definition.key}</p>
        <p className="text-[11px] text-muted">
          {definition.type}
          {definition.required ? ' · مطلوب' : ' · اختياري'}
        </p>
      </div>
      <span className="num max-w-[45%] shrink-0 truncate text-end text-xs text-text">{displayValue(currentValue)}</span>
    </div>
  );
}

export function Inspector({
  node,
  registries,
}: {
  node: AppSchemaComponent | null;
  registries: AppBuilderRegistries | null;
}) {
  const t = useTranslations('appBuilder.builder');

  if (!node) {
    return <p className="px-3 py-6 text-center text-xs text-muted">{t('inspectorEmpty')}</p>;
  }

  const definition = registries?.components[node.type];
  if (!definition) {
    return <p className="px-3 py-6 text-center text-xs text-muted">{t('inspectorUnknownType', { type: node.type })}</p>;
  }

  const actionDefinition = node.action ? registries?.actions[node.action.type] : undefined;

  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-text">{definition.type}</h3>
          <Badge tone="muted">{definition.category}</Badge>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">{definition.notes}</p>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted">{t('propsTitle')}</p>
        {definition.props.length === 0 ? (
          <p className="text-xs text-muted">{t('noProps')}</p>
        ) : (
          definition.props.map((prop) => (
            <PropRow key={prop.key} definition={prop} currentValue={node.props?.[prop.key]} />
          ))
        )}
      </div>

      {definition.actionable ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t('actionTitle')}</p>
          {!node.action ? (
            <p className="text-xs text-muted">{t('noAction')}</p>
          ) : !actionDefinition ? (
            <p className="text-xs text-muted">{t('inspectorUnknownType', { type: node.action.type })}</p>
          ) : (
            <div className="space-y-1">
              <Badge tone="neutral">{actionDefinition.type}</Badge>
              {actionDefinition.params.map((param) => (
                <ActionParamRow key={param.key} definition={param} currentValue={node.action?.params?.[param.key]} />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

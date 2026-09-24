'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import {
  createComponentFromDefinition,
  type AppSchemaActionRef, type AppSchemaComponent, type AppBuilderRegistries,
  type RegistryActionParamDefinition, type RegistryPropDefinition,
} from '@/lib/app-builder';

/**
 * APP-BUILDER-6 — لوحة خصائص **قابلة للتحرير**، مبنيّة على شكل APP-BUILDER-5 للقراءة
 * فقط حرفياً (نفس الكثافة والتخطيط — القيمة فقط صارت تفاعلية)، مصدرها نفسه
 * `ComponentRegistry`/`ActionRegistry`. انظر `APP-BUILDER-6-UX-EVIDENCE-PASS.md`.
 */

const MULTILINE_PROP_KEYS = new Set(['text', 'description']);

function PropField({
  definition,
  value,
  onChange,
}: {
  definition: RegistryPropDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (definition.enum_values && definition.enum_values.length > 0) {
    const current = typeof value === 'string' ? value : '';
    return (
      <Select value={current} onChange={(event) => onChange(event.target.value)} className="h-8 text-xs">
        {definition.enum_values.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </Select>
    );
  }

  switch (definition.type) {
    case 'integer': {
      const current = typeof value === 'number' ? value : '';
      return (
        <Input
          type="number"
          className="h-8 text-xs"
          value={current}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
        />
      );
    }
    case 'amountMinor': {
      const minor = typeof value === 'number' ? value : 0;
      return (
        <Input
          type="number"
          step="0.01"
          className="h-8 text-xs"
          value={minor / 100}
          onChange={(event) => {
            const major = Number(event.target.value);
            onChange(Number.isFinite(major) ? Math.round(major * 100) : 0);
          }}
        />
      );
    }
    case 'stringList': {
      const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
      return (
        <div className="space-y-1">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-1">
              <Input
                className="h-8 text-xs"
                value={item}
                onChange={(event) => {
                  const next = [...items];
                  next[index] = event.target.value;
                  onChange(next);
                }}
              />
              <button
                type="button"
                aria-label="remove"
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange([...items, ''])}>
            +
          </Button>
        </div>
      );
    }
    case 'assetUrl': {
      const current = typeof value === 'string' ? value : '';
      return (
        <Input
          type="url"
          dir="ltr"
          className="h-8 text-xs"
          placeholder="https://"
          value={current}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }
    default: {
      const current = typeof value === 'string' ? value : '';
      if (MULTILINE_PROP_KEYS.has(definition.key)) {
        return <Textarea className="min-h-16 text-xs" value={current} onChange={(event) => onChange(event.target.value)} />;
      }
      return <Input className="h-8 text-xs" value={current} onChange={(event) => onChange(event.target.value)} />;
    }
  }
}

function PropRow({
  definition,
  value,
  onChange,
}: {
  definition: RegistryPropDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  return (
    <div className="space-y-1 border-b border-border py-2 last:border-0">
      <label className="block text-xs font-medium text-text">
        {definition.key}
        {definition.required ? <span className="text-negative"> *</span> : null}
      </label>
      <PropField definition={definition} value={value} onChange={onChange} />
    </div>
  );
}

function ActionParamField({
  definition,
  value,
  onChange,
}: {
  definition: RegistryActionParamDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (definition.type === 'integer') {
    const current = typeof value === 'number' ? value : '';
    return (
      <Input
        type="number"
        min={definition.min_value ?? undefined}
        className="h-8 text-xs"
        value={current}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    );
  }
  const current = typeof value === 'string' ? value : '';
  return <Input className="h-8 text-xs" value={current} onChange={(event) => onChange(event.target.value)} />;
}

function ActionParamRow({
  definition,
  value,
  onChange,
}: {
  definition: RegistryActionParamDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  return (
    <div className="space-y-1 border-b border-border py-2 last:border-0">
      <label className="block text-xs font-medium text-text">
        {definition.key}
        {definition.required ? <span className="text-negative"> *</span> : null}
      </label>
      <ActionParamField definition={definition} value={value} onChange={onChange} />
    </div>
  );
}

export function Inspector({
  node,
  registries,
  onChange,
  onAddChild,
  onRemove,
  canRemove,
}: {
  node: AppSchemaComponent | null;
  registries: AppBuilderRegistries | null;
  onChange: (next: AppSchemaComponent) => void;
  onAddChild: (newNode: AppSchemaComponent) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const t = useTranslations('appBuilder.builder');
  const [addType, setAddType] = React.useState<string>('');

  if (!node) {
    return <p className="px-3 py-6 text-center text-xs text-muted">{t('inspectorEmpty')}</p>;
  }

  const definition = registries?.components[node.type];
  if (!definition) {
    return <p className="px-3 py-6 text-center text-xs text-muted">{t('inspectorUnknownType', { type: node.type })}</p>;
  }

  const actionDefinition = node.action ? registries?.actions[node.action.type] : undefined;
  const actionTypeOptions = registries ? Object.keys(registries.actions) : [];
  const componentTypeOptions = registries ? Object.keys(registries.components) : [];
  const canAddChild = definition.children_rule.kind === 'unboundedAny';
  const injectedParams = new Set(definition.injected_runtime_action_params);

  function setProp(key: string, value: unknown) {
    onChange({ ...node!, props: { ...node!.props, [key]: value } });
  }

  function attachAction(type: string) {
    if (!type) {
      const { action: _dropped, ...rest } = node!;
      onChange(rest);
      return;
    }
    const actionDef = registries?.actions[type];
    const params: Record<string, unknown> = {};
    for (const param of actionDef?.params ?? []) {
      if (injectedParams.has(param.key)) continue;
      if (param.default !== null && param.default !== undefined) params[param.key] = param.default;
    }
    onChange({ ...node!, action: { type, ...(Object.keys(params).length > 0 ? { params } : {}) } });
  }

  function setActionParam(key: string, value: unknown) {
    if (!node!.action) return;
    const nextAction: AppSchemaActionRef = { ...node!.action, params: { ...node!.action.params, [key]: value } };
    onChange({ ...node!, action: nextAction });
  }

  function handleAddChild() {
    if (!addType || !registries) return;
    const childDefinition = registries.components[addType];
    if (!childDefinition) return;
    onAddChild(createComponentFromDefinition(addType, childDefinition));
    setAddType('');
  }

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
            <PropRow key={prop.key} definition={prop} value={node.props?.[prop.key]} onChange={(v) => setProp(prop.key, v)} />
          ))
        )}
      </div>

      {definition.actionable ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t('actionTitle')}</p>
          <Select value={node.action?.type ?? ''} onChange={(event) => attachAction(event.target.value)} className="mb-2 h-8 text-xs">
            <option value="">{t('noAction')}</option>
            {actionTypeOptions.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </Select>
          {node.action && !actionDefinition ? (
            <p className="text-xs text-muted">{t('inspectorUnknownType', { type: node.action.type })}</p>
          ) : null}
          {node.action && actionDefinition ? (
            <div>
              {actionDefinition.params
                .filter((param) => !injectedParams.has(param.key))
                .map((param) => (
                  <ActionParamRow
                    key={param.key}
                    definition={param}
                    value={node.action?.params?.[param.key]}
                    onChange={(v) => setActionParam(param.key, v)}
                  />
                ))}
              {actionDefinition.params.some((param) => injectedParams.has(param.key)) ? (
                <p className="pt-1 text-[11px] text-muted">{t('injectedParamNote')}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {canAddChild ? (
        <div className="border-t border-border pt-3">
          <p className="mb-1 text-xs font-medium text-muted">{t('addChildTitle')}</p>
          <div className="flex items-center gap-1.5">
            <Select value={addType} onChange={(event) => setAddType(event.target.value)} className="h-8 text-xs">
              <option value="">{t('addChildPlaceholder')}</option>
              {componentTypeOptions.map((type) => (
                <option key={type} value={type}>{type}</option>
              ))}
            </Select>
            <Button type="button" size="sm" className="h-8 shrink-0 text-xs" disabled={!addType} onClick={handleAddChild}>
              {t('addChildAction')}
            </Button>
          </div>
        </div>
      ) : null}

      {canRemove ? (
        <div className="border-t border-border pt-3">
          <Button type="button" variant="danger" size="sm" className="h-8 w-full text-xs" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} aria-hidden="true" />
            {t('removeComponent')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

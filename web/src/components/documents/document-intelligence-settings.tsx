'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

/**
 * إعدادات الذكاء المستندي — تحكّمان **مستقلّان**:
 *  1) المعالجة الذكية (تفعيل + الأنواع المسموح بمعالجتها).
 *  2) سياسة الاحتفاظ بالأصل (أربع دلالات، اختيار واحد).
 *
 * القرار غير القابل للكسر: تفعيل المعالجة لا يفرض الاحتفاظ ولا يمنعه. لذا
 * القسمان منفصلان بصرياً وفي الحمولة معاً.
 */

type IntelligenceSettings = {
  processing_enabled: boolean;
  allowed_document_types: string[];
  retention_mode: string;
  retains_original_in_document_center: boolean;
  attaches_original_to_record: boolean;
};

type Payload = {
  settings: IntelligenceSettings;
  available_document_types: string[];
  available_retention_modes: string[];
};

const TYPE_LABEL_KEY: Record<string, string> = {
  purchase_invoice: 'typePurchaseInvoice',
  sales_invoice: 'typeSalesInvoice',
  expense: 'typeExpense',
  delivery_note: 'typeDeliveryNote',
  receipt: 'typeReceipt',
  credit_note: 'typeCreditNote',
  debit_note: 'typeDebitNote',
};

const RETENTION_LABEL_KEY: Record<string, string> = {
  document_center_only: 'retentionDocumentCenterOnly',
  record_attachment_only: 'retentionRecordAttachmentOnly',
  document_center_and_attachment: 'retentionDocumentCenterAndAttachment',
  do_not_retain: 'retentionDoNotRetain',
};

export function DocumentIntelligenceSettings() {
  const t = useTranslations('documentIntelligence');
  const tt = useTranslations('documentCenterReview');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // مسودة قابلة للتحرير محلياً قبل الحفظ.
  const [processingEnabled, setProcessingEnabled] = useState(false);
  const [allowedTypes, setAllowedTypes] = useState<string[]>([]);
  const [retentionMode, setRetentionMode] = useState('document_center_only');

  const hydrate = useCallback((data: Payload) => {
    setPayload(data);
    setProcessingEnabled(data.settings.processing_enabled);
    setAllowedTypes(data.settings.allowed_document_types);
    setRetentionMode(data.settings.retention_mode);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api<{ data: Payload }>('/document-intelligence-settings');
      hydrate(result.data);
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [hydrate, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleType = (type: string) => {
    setSaved(false);
    setAllowedTypes((current) =>
      current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type],
    );
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api<{ data: Payload }>('/document-intelligence-settings', {
        method: 'PUT',
        body: {
          processing_enabled: processingEnabled,
          allowed_document_types: allowedTypes,
          retention_mode: retentionMode,
        },
      });
      hydrate(result.data);
      setSaved(true);
    } catch (exception) {
      setError(exception instanceof ApiError ? exception.message : t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card><CardContent className="py-8 text-sm text-muted">{t('loading')}</CardContent></Card>
    );
  }

  if (error && payload === null) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-8 text-sm text-muted">
          <CircleAlert className="h-5 w-5" aria-hidden="true" />
          {error}
          <Button variant="outline" onClick={() => void load()}>{t('retry')}</Button>
        </CardContent>
      </Card>
    );
  }

  const availableTypes = payload?.available_document_types ?? [];
  const availableModes = payload?.available_retention_modes ?? [];

  return (
    <Card>
      <CardContent className="space-y-6 py-5">
        <div>
          <h2 className="text-lg font-semibold text-text">{t('title')}</h2>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>

        {/* ── القسم الأول: المعالجة الذكية ── */}
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-medium text-text">{t('processingHeading')}</h3>
              <p className="mt-1 text-sm text-muted">{t('processingHint')}</p>
            </div>
            <Switch
              checked={processingEnabled}
              onCheckedChange={(value) => { setSaved(false); setProcessingEnabled(value); }}
              aria-label={t('processingToggle')}
            />
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-sm font-medium text-text">{t('allowedTypesHeading')}</p>
            <p className="mt-1 text-sm text-muted">{t('allowedTypesHint')}</p>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {availableTypes.map((type) => {
                const labelKey = TYPE_LABEL_KEY[type];
                const label = labelKey ? tt(labelKey) : type;
                return (
                  <li key={type} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                    <span className="text-sm text-text">{label}</span>
                    <Switch
                      checked={allowedTypes.includes(type)}
                      onCheckedChange={() => toggleType(type)}
                      disabled={!processingEnabled}
                      aria-label={label}
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* ── القسم الثاني: الاحتفاظ بالأصل (مستقلّ تماماً) ── */}
        <section className="space-y-3 rounded-lg border border-border p-4">
          <div>
            <h3 className="font-medium text-text">{t('retentionHeading')}</h3>
            <p className="mt-1 text-sm text-muted">{t('retentionHint')}</p>
          </div>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t('retentionHeading')}</legend>
            {availableModes.map((mode) => {
              const labelKey = RETENTION_LABEL_KEY[mode];
              const label = labelKey ? t(labelKey) : mode;
              return (
                <label
                  key={mode}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm text-text has-[:checked]:border-primary"
                >
                  <input
                    type="radio"
                    name="document-retention-mode"
                    value={mode}
                    checked={retentionMode === mode}
                    onChange={() => { setSaved(false); setRetentionMode(mode); }}
                    className="h-4 w-4 accent-primary"
                  />
                  {label}
                </label>
              );
            })}
          </fieldset>
        </section>

        <p className="text-xs text-muted">{t('deferredNote')}</p>

        <div className="flex items-center gap-3">
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
          {saved && <span className="text-sm text-positive">{t('saved')}</span>}
          {error && payload !== null && (
            <span className="flex items-center gap-2 text-sm text-negative">
              <CircleAlert className="h-4 w-4" aria-hidden="true" />
              {error}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

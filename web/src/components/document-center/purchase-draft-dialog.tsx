'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError, hasApiStatus } from '@/lib/api';

type Warehouse = { id: string; name: string; is_active: boolean };
type CostCenter = { id: string; code: string; name: string; is_active: boolean };

type Labels = {
  title: string;
  reason: string;
  warehouse: string;
  costCenter: string;
  noWarehouse: string;
  noCostCenter: string;
  cancel: string;
  create: string;
  required: string;
  loadOptions: string;
  optionsFailed: string;
  retry: string;
  failed: string;
  stale: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  endpoint: string;
  expectedVersion: number;
  onSuccess: () => void;
  labels: Labels;
};

export function PurchaseDraftDialog({ open, onClose, endpoint, expectedVersion, onSuccess, labels }: Props) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [costCenters, setCostCenters] = useState<CostCenter[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadOptions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [warehouseResponse, costCenterResponse] = await Promise.all([
        api<{ data: Warehouse[] }>('/warehouses'),
        api<{ data: CostCenter[] }>('/cost-centers'),
      ]);
      setWarehouses(warehouseResponse.data.filter((item) => item.is_active));
      setCostCenters(costCenterResponse.data.filter((item) => item.is_active));
    } catch {
      setError(labels.optionsFailed);
    } finally {
      setLoading(false);
    }
  }, [labels.optionsFailed]);

  useEffect(() => {
    if (open) {
      setReason('');
      setWarehouseId('');
      setCostCenterId('');
      setError(null);
      void loadOptions();
    }
  }, [open, loadOptions]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!reason.trim()) {
      setError(labels.required);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(endpoint, {
        method: 'POST',
        body: {
          expected_version: expectedVersion,
          reason: reason.trim(),
          warehouse_id: warehouseId || undefined,
          cost_center_id: costCenterId || undefined,
        },
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(hasApiStatus(err, 409) ? labels.stale : err instanceof ApiError ? err.message : labels.failed);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={labels.title}>
      <form className="space-y-4" onSubmit={submit}>
        <p className="text-sm text-muted">{labels.loadOptions}</p>
        <div className="grid gap-2">
          <Label htmlFor="purchase-warehouse">{labels.warehouse}</Label>
          <Select id="purchase-warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} disabled={loading}>
            <option value="">{labels.noWarehouse}</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="purchase-cost-center">{labels.costCenter}</Label>
          <Select id="purchase-cost-center" value={costCenterId} onChange={(e) => setCostCenterId(e.target.value)} disabled={loading}>
            <option value="">{labels.noCostCenter}</option>
            {costCenters.map((center) => (
              <option key={center.id} value={center.id}>{center.code} — {center.name}</option>
            ))}
          </Select>
        </div>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label={labels.reason} placeholder={labels.reason} />
        {error && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="text-sm text-negative">{error}</p>
            {error === labels.optionsFailed && (
              <Button type="button" size="sm" variant="outline" onClick={() => void loadOptions()}>{labels.retry}</Button>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>{labels.cancel}</Button>
          <Button type="submit" disabled={saving || loading}>{labels.create}</Button>
        </div>
      </form>
    </Dialog>
  );
}

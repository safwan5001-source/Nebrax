'use client';

import { useId, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { FormAlert } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime } from '@/lib/formatting';
import { classifyAcceptError, failureMeansStale, type AcceptFailure } from './accept-order';
import {
  FAILURE_REASONS,
  FULFILLMENT_NOTE_MAX,
  type FulfillmentActionName,
  type OrderDetail,
  type OrderFulfillment,
} from './contract';
import {
  fulfillOrder,
  toLatinDigits,
  updateFulfillmentDetails,
  validateDetails,
  validateFailure,
  type FulfillmentActionInput,
  type FulfillmentDetails,
} from './fulfill-order';
import { ordersMessages } from './messages';

type DialogKind = 'fail' | 'dispatch' | 'deliver' | 'return' | 'pickup';

/** إجراءات لها حوار (تأكيد أو مدخلات)؛ الباقي ينفَّذ بنقرة واحدة. */
const DIALOG_ACTIONS: Partial<Record<FulfillmentActionName, DialogKind>> = { fail: 'fail', dispatch: 'dispatch', deliver: 'deliver', return: 'return', pickup: 'pickup' };
const TERMINAL = ['delivered', 'picked_up'];
const SWITCHABLE = ['preparing', 'ready', 'returned_to_store'];

/**
 * COPS-H2-3 — قسم «التنفيذ» في تفاصيل الطلب. **الحقائق المخزَّنة تُعرض دائماً** (مهما كان وضع بوابة التنفيذ — AR-3). **الإجراءات من عقد القراءة وحده**
 * (`fulfillment_actions`، استرشادي): غيابه ⇒ لا إجراء (بوابة مغلقة أو بلا `commerce.orders.manage`)، والخادم يحكم دائماً تحت الأقفال. كل كتابة تُرسل
 * `expected_version` الظاهر؛ 409/404/شبكة ⇒ يُحدَّث الأب من الخادم ويُقفل كل شيء حتى يصل تحديث. قفل إرسال مكرر متزامن بـ`useRef`.
 * لا إجراء «إلغاء/إغلاق/استرداد/شطب» لتعذّر التسليم (AR-1) — نصّ ثابت يشرح الحالة. التنفيذ تشغيلي لا محاسبي ولا مخزني ولا تحصيلي.
 */
export function FulfillmentSection({
  order,
  canManage,
  stale,
  onUpdated,
  onStale,
  large = false,
}: {
  order: OrderDetail;
  canManage: boolean;
  stale: boolean;
  onUpdated: (order: OrderDetail) => void;
  onStale: () => void;
  /** COPS-H3-5: أزرار إجراءات الاستقبال بهدف لمس ≥ 44px (لوحة الاستقبال). الافتراضي كما كان. */
  large?: boolean;
}) {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const f = order.fulfillment ?? null;
  const actions = order.fulfillment_actions ?? null;
  const contractPresent = canManage && actions !== null;
  const isPickup = f?.type === 'pickup' || (f === null && order.delivery_method === 'pickup');
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AcceptFailure | null>(null);
  const [notice, setNotice] = useState<'fulfill' | 'details' | null>(null);
  const inFlight = useRef(false);

  const available = (actions ?? []).filter((a) => a.available);
  const blocked = (actions ?? []).filter((a) => !a.available);
  const disabled = busy || stale;

  /** ينفّذ إجراءً عبر الخادم. يعيد true عند النجاح. الفشل: يُسجَّل، وحالة قديمة/غير مؤكَّدة ⇒ `onStale` (قفل + تحديث). */
  const run = async (action: FulfillmentActionName, input: FulfillmentActionInput = {}): Promise<boolean> => {
    if (inFlight.current || stale) return false;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    setNotice(null);
    try {
      const updated = await fulfillOrder(order.id, action, f?.version ?? 0, input);
      onUpdated(updated);
      setNotice('fulfill');

      return true;
    } catch (error) {
      const failed = classifyAcceptError(error);
      setFailure(failed);
      if (failureMeansStale(failed)) {
        // الحالة قديمة/غير مؤكَّدة: أي تأكيد مفتوح يحمل قيماً أُدخلت على قراءة قديمة — يُغلق نهائياً ويُعاد فتحه على التفاصيل المحدَّثة
        // (وإلا أعاد المستخدم إرسال القيم القديمة بنسخة جديدة فيكتب فوق تعديل موظف آخر رغم حارس النسخة).
        setDialog(null);
        onStale();
      }

      return false;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const failureText = (() => {
    if (failure === null) return null;
    const base = label('fulfillError', failure.kind);
    const reasonText = failure.reason ? label('blocked', failure.reason) : null;

    return reasonText && reasonText !== failure.reason ? `${base} ${reasonText}` : base;
  })();

  const onAction = (name: string) => {
    const action = name as FulfillmentActionName;
    const withDialog = DIALOG_ACTIONS[action];
    if (withDialog) {
      setFailure(null);
      setDialog(withDialog);

      return;
    }
    void run(action);
  };

  const actionLabel = (name: string) => (name === 'mark_ready' && isPickup ? t('fulfillAction.mark_ready_pickup') : label('fulfillAction', name));
  const statusLabel = (status: string) => (status === 'ready' && f?.type === 'pickup' ? t('fulfillment.ready_pickup') : label('fulfillment', status));

  return (
    <div className="space-y-4" data-testid="fulfillment-section">
      <p className="text-xs text-muted">{t('fulfillmentOperationalNote')}</p>

      {f === null ? <p className="text-sm text-muted">{t('fulfillmentNone')}</p> : <FulfillmentFacts f={f} locale={locale} statusLabel={statusLabel(f.status)} />}

      {f?.status === 'delivery_failed' ? (
        <FormAlert tone="warning">
          <p className="font-medium text-text">{t('deliveryFailedTitle')}</p>
          <p className="mt-1 text-muted">{t('deliveryFailedBody')}</p>
        </FormAlert>
      ) : null}
      {f?.status === 'delivered' && (order.payment.status === 'awaiting_collection' || order.payment.status === 'pending') ? (
        <FormAlert tone="info">{t('deliveredNotCollected')}</FormAlert>
      ) : null}

      {notice === 'fulfill' ? (
        <div role="status">
          <FormAlert tone="info">{t('fulfillSuccess')}</FormAlert>
        </div>
      ) : null}
      {notice === 'details' ? (
        <div role="status">
          <FormAlert tone="info">{t('fulfillDetailsSuccess')}</FormAlert>
        </div>
      ) : null}
      {failureText && dialog === null ? (
        <div role="alert">
          <FormAlert tone="error">{failureText}</FormAlert>
        </div>
      ) : null}

      {!contractPresent && f !== null && !TERMINAL.includes(f.status) ? <p className="text-xs text-muted">{t('fulfillmentReadOnly')}</p> : null}

      {contractPresent && available.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('sectionFulfillment')}>
          {available.map((a) => (
            <Button
              key={a.action}
              type="button"
              variant={a.action === 'fail' ? 'outline' : 'primary'}
              className={large ? 'min-h-11 px-5' : undefined}
              disabled={disabled}
              aria-disabled={disabled}
              aria-busy={busy}
              onClick={() => onAction(a.action)}
            >
              {busy ? t('fulfillSubmitting') : actionLabel(a.action)}
            </Button>
          ))}
        </div>
      ) : null}
      {contractPresent && available.length === 0 && blocked.length > 0 ? (
        <FormAlert tone="warning">
          <ul className="space-y-1">
            {Array.from(new Set(blocked.map((b) => b.blocked_reason ?? ''))).map((reason) => (
              <li key={reason}>{reason ? label('blocked', reason) : '—'}</li>
            ))}
          </ul>
        </FormAlert>
      ) : null}

      {contractPresent && f !== null && !TERMINAL.includes(f.status) ? (
        <DetailsForm
          key={f.version}
          f={f}
          disabledAll={disabled}
          onSave={async (details) => {
            if (inFlight.current || stale) return false;
            inFlight.current = true;
            setBusy(true);
            setFailure(null);
            setNotice(null);
            try {
              onUpdated(await updateFulfillmentDetails(order.id, f.version, details));
              setNotice('details');

              return true;
            } catch (error) {
              const failed = classifyAcceptError(error);
              setFailure(failed);
              if (failureMeansStale(failed)) onStale();

              return false;
            } finally {
              inFlight.current = false;
              setBusy(false);
            }
          }}
        />
      ) : null}

      {dialog !== null && f !== null
        ? (
            <ActionDialog
              key={`${dialog}-${f.version}`}
              kind={dialog}
              f={f}
              orderNumber={order.number}
              stale={stale}
              failureText={failureText}
              busy={busy}
              onClose={() => {
                if (!inFlight.current) {
                  setDialog(null);
                  setFailure(null);
                }
              }}
              onSubmit={async (input) => {
                const action: FulfillmentActionName = dialog;
                const ok = await run(action, input);
                if (ok) setDialog(null);

                return ok;
              }}
            />
          )
        : null}
    </div>
  );
}

function FulfillmentFacts({ f, locale, statusLabel }: { f: OrderFulfillment; locale: string; statusLabel: string }) {
  const { t, label } = ordersMessages(locale);
  const stamp = (key: string) => (f.timestamps[key] ? formatDateTime(f.timestamps[key] as string, locale) : null);
  const rows: [string, string | null, boolean?][] = [
    [t('fulfillmentStatusLabel'), statusLabel],
    [t('fulfillmentTypeLabel'), label('fulfillmentType', f.type)],
    [t('fulfillmentWarehouse'), f.warehouse.name],
    [t('carrierName'), f.carrier.name],
    [t('trackingNumber'), f.carrier.tracking_number, true],
    [t('courierName'), f.courier.name],
    [t('courierPhone'), f.courier.phone, true],
    [t('fulfillmentAttempts'), f.delivery_attempts > 0 ? String(f.delivery_attempts) : null, true],
    [t('fulfillmentLastFailure'), f.last_failure ? `${label('failReason', f.last_failure.reason)}${f.last_failure.at ? ` · ${formatDateTime(f.last_failure.at, locale)}` : ''}` : null],
    [t('fulfillmentLastFailureNote'), f.last_failure?.note ?? null],
  ];
  const visible = rows.filter(([, value]) => value !== null && value !== '');
  const times: [string, string | null][] = [
    ['preparing_at', stamp('preparing_at')], ['ready_at', stamp('ready_at')], ['first_dispatched_at', stamp('first_dispatched_at')],
    ['last_failed_at', stamp('last_failed_at')], ['last_returned_at', stamp('last_returned_at')], ['delivered_at', stamp('delivered_at')], ['picked_up_at', stamp('picked_up_at')],
  ];

  return (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {visible.map(([name, value, ltr]) => (
          <div key={name} className="min-w-0">
            <dt className="text-xs text-muted">{name}</dt>
            <dd className={ltr ? 'num break-words text-text' : 'break-words text-text'} dir={ltr ? 'ltr' : undefined}>
              {ltr ? value : <bdi>{value}</bdi>}
            </dd>
          </div>
        ))}
        {f.carrier.tracking_url ? (
          <div className="min-w-0">
            <dt className="text-xs text-muted">{t('trackingUrl')}</dt>
            <dd className="break-words text-text" dir="ltr">
              <a href={f.carrier.tracking_url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                {f.carrier.tracking_url}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
      {times.some(([, v]) => v !== null) ? (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-muted">{t('fulfillmentTimestamps')}</h3>
          <ul className="space-y-0.5 text-xs text-muted">
            {times.filter(([, v]) => v !== null).map(([key, v]) => (
              <li key={key} className="num" dir="ltr">
                {key.replace(/_at$/, '').replace(/_/g, ' ')}: {v}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DetailsForm({ f, disabledAll, onSave }: { f: OrderFulfillment; disabledAll: boolean; onSave: (details: FulfillmentDetails) => Promise<boolean> }) {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const id = useId();
  const [form, setForm] = useState({
    type: f.type === 'carrier' ? 'carrier' : 'local_delivery',
    carrier_name: f.carrier.name ?? '',
    tracking_number: f.carrier.tracking_number ?? '',
    tracking_url: f.carrier.tracking_url ?? '',
    courier_name: f.courier.name ?? '',
    courier_phone: f.courier.phone ?? '',
    note: f.last_failure?.note ?? '',
  });
  const [attempted, setAttempted] = useState(false);
  const canSwitch = f.type !== 'pickup' && SWITCHABLE.includes(f.status);
  const showNote = f.last_failure !== null;

  /** يُرسل الحقول المتغيّرة فقط (مقارنة بالمعروض). */
  const changed = (): FulfillmentDetails => {
    const out: FulfillmentDetails = {};
    if (canSwitch && form.type !== f.type) out.type = form.type as 'local_delivery' | 'carrier';
    if (form.carrier_name.trim() !== (f.carrier.name ?? '')) out.carrier_name = form.carrier_name;
    if (form.tracking_number.trim() !== (f.carrier.tracking_number ?? '')) out.tracking_number = form.tracking_number;
    if (form.tracking_url.trim() !== (f.carrier.tracking_url ?? '')) out.tracking_url = form.tracking_url;
    if (form.courier_name.trim() !== (f.courier.name ?? '')) out.courier_name = form.courier_name;
    if (toLatinDigits(form.courier_phone.trim()) !== (f.courier.phone ?? '')) out.courier_phone = form.courier_phone;
    if (showNote && form.note.trim() !== (f.last_failure?.note ?? '')) out.note = form.note;

    return out;
  };
  const diff = changed();
  const dirty = Object.keys(diff).length > 0;
  const problem = attempted ? validateDetails(diff) : null;

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="space-y-3 rounded border border-border p-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (!dirty || validateDetails(diff) !== null) return;
        void onSave(diff);
      }}
    >
      <h3 className="text-sm font-semibold text-text">{t('detailsTitle')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {canSwitch ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-type`}>{t('deliveryTypeSwitch')}</Label>
            <Select id={`${id}-type`} value={form.type} onChange={set('type')} disabled={disabledAll}>
              <option value="local_delivery">{label('fulfillmentType', 'local_delivery')}</option>
              <option value="carrier">{label('fulfillmentType', 'carrier')}</option>
            </Select>
          </div>
        ) : null}
        <Field id={`${id}-carrier`} label={t('carrierName')} value={form.carrier_name} onChange={set('carrier_name')} disabled={disabledAll} maxLength={100} />
        <Field id={`${id}-number`} label={t('trackingNumber')} value={form.tracking_number} onChange={set('tracking_number')} disabled={disabledAll} maxLength={100} ltr />
        <Field id={`${id}-url`} label={t('trackingUrl')} value={form.tracking_url} onChange={set('tracking_url')} disabled={disabledAll} maxLength={500} ltr />
        <Field id={`${id}-courier`} label={t('courierName')} value={form.courier_name} onChange={set('courier_name')} disabled={disabledAll} maxLength={100} />
        <Field id={`${id}-phone`} label={t('courierPhone')} value={form.courier_phone} onChange={set('courier_phone')} disabled={disabledAll} maxLength={32} ltr />
      </div>
      <p className="text-xs text-muted">{t('courierInternalNote')}</p>
      {showNote ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-note`}>{t('failureNoteEdit')}</Label>
          <Textarea id={`${id}-note`} rows={2} maxLength={FULFILLMENT_NOTE_MAX} value={form.note} onChange={set('note')} disabled={disabledAll} />
        </div>
      ) : null}
      {problem ? (
        <p role="alert" className="text-xs text-negative">
          {label('fulfillValidation', problem)}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={disabledAll || !dirty} aria-disabled={disabledAll || !dirty}>
          {disabledAll ? t('savingDetails') : t('saveDetails')}
        </Button>
      </div>
    </form>
  );
}

function Field({ id, label, value, onChange, disabled, maxLength, ltr }: { id: string; label: string; value: string; onChange: (e: { target: { value: string } }) => void; disabled: boolean; maxLength: number; ltr?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={onChange} disabled={disabled} maxLength={maxLength} dir={ltr ? 'ltr' : undefined} />
    </div>
  );
}

/** حوار الإجراءات ذات المدخلات/التأكيد: تعذّر التسليم (سبب+ملاحظة)، الإرسال (بيانات التوصيل)، التسليم/العودة/الاستلام (تأكيد). لا يقرّر الأهلية. */
function ActionDialog({
  kind,
  f,
  orderNumber,
  stale,
  failureText,
  busy,
  onClose,
  onSubmit,
}: {
  kind: DialogKind;
  f: OrderFulfillment;
  orderNumber: string;
  stale: boolean;
  failureText: string | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: FulfillmentActionInput) => Promise<boolean>;
}) {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const id = useId();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [carrier, setCarrier] = useState(f.carrier.name ?? '');
  const [number, setNumber] = useState(f.carrier.tracking_number ?? '');
  const [url, setUrl] = useState(f.carrier.tracking_url ?? '');
  const [courier, setCourier] = useState(f.courier.name ?? '');
  const [phone, setPhone] = useState(f.courier.phone ?? '');
  const [attempted, setAttempted] = useState(false);

  const titleKey = ({ fail: 'failDialogTitle', dispatch: 'dispatchDialogTitle', deliver: 'deliverDialogTitle', return: 'returnDialogTitle', pickup: 'pickupDialogTitle' } as const)[kind];
  const confirmKey = ({ fail: 'failConfirm', dispatch: 'dispatchConfirm', deliver: 'deliverConfirm', return: 'returnConfirm', pickup: 'pickupConfirm' } as const)[kind];

  const problem = (): ReturnType<typeof validateFailure> | ReturnType<typeof validateDetails> => {
    if (kind === 'fail') return validateFailure(reason, note);
    if (kind === 'dispatch') {
      if (f.type === 'carrier' && carrier.trim() === '') return 'carrier_required';

      return validateDetails({ carrier_name: carrier, tracking_number: number, tracking_url: url, courier_name: courier, courier_phone: phone });
    }

    return null;
  };
  const shown = attempted ? problem() : null;

  const submit = () => {
    setAttempted(true);
    if (problem() !== null) return;
    if (kind === 'fail') void onSubmit({ reason, note });
    else if (kind === 'dispatch') void onSubmit({ carrier_name: carrier, tracking_number: number, tracking_url: url, courier_name: courier, courier_phone: phone });
    else void onSubmit({});
  };

  return (
    <Dialog open onClose={onClose} title={`${t(titleKey)} ${orderNumber}`} hideClose={busy}>
      <form
        className="space-y-4"
        aria-busy={busy}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {kind === 'fail' ? (
          <>
            <p className="text-sm leading-relaxed text-muted">{t('failDialogIntro')}</p>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-reason`}>{t('failReasonLabel')}</Label>
              <Select id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy || stale}>
                <option value="">{t('failReasonPlaceholder')}</option>
                {FAILURE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {label('failReason', r)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-note`}>{t('failNoteLabel')}</Label>
              <Textarea id={`${id}-note`} rows={3} maxLength={FULFILLMENT_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy || stale} />
              <span className="num text-xs text-muted" dir="ltr">
                {note.length}/{FULFILLMENT_NOTE_MAX}
              </span>
            </div>
          </>
        ) : null}
        {kind === 'dispatch' ? (
          <>
            <p className="text-sm leading-relaxed text-muted">{t('dispatchDialogIntro')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id={`${id}-carrier`} label={t('carrierName')} value={carrier} onChange={(e) => setCarrier(e.target.value)} disabled={busy || stale} maxLength={100} />
              <Field id={`${id}-number`} label={t('trackingNumber')} value={number} onChange={(e) => setNumber(e.target.value)} disabled={busy || stale} maxLength={100} ltr />
              <Field id={`${id}-url`} label={t('trackingUrl')} value={url} onChange={(e) => setUrl(e.target.value)} disabled={busy || stale} maxLength={500} ltr />
              <Field id={`${id}-courier`} label={t('courierName')} value={courier} onChange={(e) => setCourier(e.target.value)} disabled={busy || stale} maxLength={100} />
              <Field id={`${id}-phone`} label={t('courierPhone')} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy || stale} maxLength={32} ltr />
            </div>
            <p className="text-xs text-muted">{t('courierInternalNote')}</p>
          </>
        ) : null}
        {kind === 'deliver' ? <p className="text-sm leading-relaxed text-muted">{t('deliverDialogBody')}</p> : null}
        {kind === 'return' ? <p className="text-sm leading-relaxed text-muted">{t('returnDialogBody')}</p> : null}
        {kind === 'pickup' ? <p className="text-sm leading-relaxed text-muted">{t('pickupDialogBody')}</p> : null}

        {shown ? (
          <p role="alert" className="text-xs text-negative">
            {label('fulfillValidation', shown)}
          </p>
        ) : null}
        {failureText ? <FormAlert tone="error">{failureText}</FormAlert> : null}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {stale ? t('dialogClose') : t('dialogKeep')}
          </Button>
          <Button type="submit" variant={kind === 'fail' ? 'danger' : 'primary'} disabled={busy || stale} aria-disabled={busy || stale}>
            {busy ? t('fulfillSubmitting') : t(confirmKey)}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

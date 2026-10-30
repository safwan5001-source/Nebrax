interface DeliveryRow {
  channel: string;
  reference: string;
  branch: string;
  /** الحالة الثابتة للصف؛ صفّ `live` يمرّ على كل الحالات بالترتيب. */
  state?: string;
}

interface DeliveryBoardProps {
  label: string;
  title: string;
  subtitle: string;
  all: string;
  referenceLabel: string;
  branchLabel: string;
  states: string[];
  live: DeliveryRow;
  rows: DeliveryRow[];
}

/**
 * تمثيل لصندوق التوصيل بتسميات الشاشة الفعلية (`deliveryHub.*`) وبيانات افتراضية.
 * القنوات بأسماء عامة عمداً: لا شعار ولا اسم لمنصة بعينها، لأن لا ربط مباشراً بأي منصة اليوم.
 */
export function DeliveryBoard({ label, title, subtitle, all, referenceLabel, branchLabel, states, live, rows }: DeliveryBoardProps) {
  return (
    <div className="lp-board" role="img" aria-label={label} data-loop="">
      <div className="lp-board__head" aria-hidden="true">
        <b>{title}</b>
        <span>{subtitle}</span>
      </div>
      <div className="lp-board__filters" aria-hidden="true">
        <span data-active="">{all}</span>
        {states.map((state) => (
          <span key={state}>{state}</span>
        ))}
      </div>
      <ol className="lp-board__rows" aria-hidden="true">
        <li className="lp-board__row lp-board__row--live">
          <RowFacts row={live} referenceLabel={referenceLabel} branchLabel={branchLabel} />
          <span className="lp-board__state lp-board__state--cycle">
            {states.map((state, index) => (
              <span key={state} style={{ animationDelay: `${index * 2.4}s` }}>
                {state}
              </span>
            ))}
          </span>
          <span className="lp-board__track">
            {states.map((state, index) => (
              <i key={state} style={{ animationDelay: `${index * 2.4}s` }} />
            ))}
          </span>
        </li>
        {rows.map((row) => (
          <li key={row.reference} className="lp-board__row">
            <RowFacts row={row} referenceLabel={referenceLabel} branchLabel={branchLabel} />
            <span className="lp-board__state">{row.state}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function RowFacts({ row, referenceLabel, branchLabel }: { row: DeliveryRow; referenceLabel: string; branchLabel: string }) {
  return (
    <span className="lp-board__facts">
      <b>{row.channel}</b>
      <span>
        {referenceLabel} <bdi className="lp-num">{row.reference}</bdi>
      </span>
      <span>
        {branchLabel}: {row.branch}
      </span>
    </span>
  );
}

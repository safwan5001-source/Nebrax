'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

export interface SignalGroup {
  id: string;
  label: string;
  description: string;
  /** تسميات قواعد الرصد كما تعرضها شاشة الرقابة والتدقيق نفسها (`posAudit.rules`). */
  rules: string[];
}

interface PosAuditSignalsProps {
  groups: SignalGroup[];
  tablistLabel: string;
  rulesLabel: string;
}

/** مبدّل فئات الرصد: اللوحة الأولى ظاهرة بلا سكربت، وبقية اللوحات `hidden` حتى تُحدَّد. */
export function PosAuditSignals({ groups, tablistLabel, rulesLabel }: PosAuditSignalsProps) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function move(next: number) {
    const index = (next + groups.length) % groups.length;
    setActive(index);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = document.documentElement.dir === 'rtl';
    if (event.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) move(active + 1);
    else if (event.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) move(active - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(groups.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div className="lp-signals">
      <div className="lp-signals__tabs" role="tablist" aria-label={tablistLabel} onKeyDown={onKeyDown}>
        {groups.map((group, index) => (
          <button
            key={group.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`lp-signal-tab-${group.id}`}
            aria-selected={active === index}
            aria-controls={`lp-signal-panel-${group.id}`}
            tabIndex={active === index ? 0 : -1}
            className="lp-signals__tab"
            onClick={() => setActive(index)}
          >
            {group.label}
          </button>
        ))}
      </div>
      {groups.map((group, index) => (
        <div
          key={group.id}
          role="tabpanel"
          id={`lp-signal-panel-${group.id}`}
          aria-labelledby={`lp-signal-tab-${group.id}`}
          className="lp-signals__panel"
          hidden={active !== index}
        >
          <p>{group.description}</p>
          <p className="lp-signals__rules-label">{rulesLabel}</p>
          <ul className="lp-signals__rules">
            {group.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

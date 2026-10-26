'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LandingShot, type LandingShotName } from './landing-shot';

export interface ModuleTab {
  id: string;
  label: string;
  title: string;
  facts: string[];
  shot: LandingShotName;
  alt: string;
}

interface ModuleTabsProps {
  tabs: ModuleTab[];
  tablistLabel: string;
  note: string;
  locale: string;
}

/** مبدّل وحدات: اللوحة الأولى ظاهرة بلا سكربت، وبقية اللوحات `hidden` حتى تُحدَّد. */
export function ModuleTabs({ tabs, tablistLabel, note, locale }: ModuleTabsProps) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  // على الجوال تُمرَّر اللقطة أفقياً لتبقى مقروءة، فتصير منطقة قابلة للتركيز بلوحة المفاتيح.
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 40rem)');
    const sync = () => setNarrow(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  function move(next: number) {
    const index = (next + tabs.length) % tabs.length;
    setActive(index);
    refs.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = document.documentElement.dir === 'rtl';
    const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    const backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (event.key === forward) move(active + 1);
    else if (event.key === backward) move(active - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(tabs.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div>
      <div className="lp-tabs" role="tablist" aria-label={tablistLabel} onKeyDown={onKeyDown}>
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`lp-tab-${tab.id}`}
            className="lp-tab"
            aria-selected={active === index}
            aria-controls={`lp-panel-${tab.id}`}
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`lp-panel-${tab.id}`}
          aria-labelledby={`lp-tab-${tab.id}`}
          className="lp-panel"
          hidden={active !== index}
        >
          <div className="lp-panel__text">
            <h3>{tab.title}</h3>
            <ul className="lp-facts">
              {tab.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </div>
          <figure className="lp-shot">
            <div
              className="lp-pan"
              {...(narrow ? { role: 'region', tabIndex: 0, 'aria-label': tab.alt } : {})}
            >
              <LandingShot
                name={tab.shot}
                locale={locale}
                alt={tab.alt}
                sizes="(min-width: 1440px) 864px, (min-width: 960px) 62vw, 760px"
              />
            </div>
            <figcaption>{note}</figcaption>
          </figure>
        </div>
      ))}
    </div>
  );
}

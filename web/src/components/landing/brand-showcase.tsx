'use client';

import { useState, type CSSProperties } from 'react';
import { House, LayoutGrid, Search, ShoppingBag, User } from 'lucide-react';

export interface BrandShowcaseCopy {
  swatchLabel: string;
  swatches: { id: SwatchId; label: string }[];
  storeAria: string;
  appAria: string;
  storeName: string;
  storeSearch: string;
  heroTitle: string;
  heroCta: string;
  benefits: [string, string, string];
  featured: string;
  products: [string, string, string];
  add: string;
  greeting: string;
  tabs: [string, string, string, string];
}

export type SwatchId = 'blue' | 'emerald' | 'plum' | 'amber';

/**
 * المتجر والتطبيق كتمثيل توضيحي (لا لقطة): يتبع أقسام محرر تجربة المتجر الفعلية — بانر، مزايا،
 * منتجات مميزة — ويظهر التطبيق بالهوية نفسها. اختيار اللون يغيّر متغيّراً واحداً على الحاوية،
 * فيتلوّن الاثنان معاً كما تُزامَن هوية المتجر مع صانع التطبيقات.
 */
export function BrandShowcase({ copy }: { copy: BrandShowcaseCopy }) {
  const [swatch, setSwatch] = useState<SwatchId>('blue');
  const style = { '--mk-store': `var(--mk-swatch-${swatch})` } as CSSProperties;

  return (
    <div className="lp-brandshow" style={style}>
      <fieldset className="lp-swatches">
        <legend>{copy.swatchLabel}</legend>
        {copy.swatches.map(({ id, label }) => (
          <label key={id} className={`lp-swatch lp-swatch--${id}`}>
            <input type="radio" name="lp-swatch" value={id} checked={swatch === id} onChange={() => setSwatch(id)} />
            <span className="lp-sr">{label}</span>
          </label>
        ))}
      </fieldset>

      <div className="lp-brandshow__stage">
        <div className="lp-browser lp-store" role="img" aria-label={copy.storeAria}>
          <div className="lp-browser__bar" aria-hidden="true">
            <span />
            <span />
            <span />
            <i />
          </div>
          <div className="lp-store__body" aria-hidden="true">
            <div className="lp-store__head">
              <b>{copy.storeName}</b>
              <span className="lp-store__search">
                <Search size={12} strokeWidth={2} />
                {copy.storeSearch}
              </span>
              <ShoppingBag size={14} strokeWidth={1.8} />
            </div>
            <div className="lp-store__hero">
              <div>
                <strong>{copy.heroTitle}</strong>
                <span className="lp-store__cta">{copy.heroCta}</span>
              </div>
              <div className="lp-store__art" />
            </div>
            <ul className="lp-store__benefits">
              {copy.benefits.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
            <b className="lp-store__label">{copy.featured}</b>
            <ul className="lp-store__grid">
              {copy.products.map((product, index) => (
                <li key={product}>
                  <span className={`lp-store__thumb lp-store__thumb--${index + 1}`} />
                  <span>{product}</span>
                  <em>{copy.add}</em>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="lp-phone lp-app" role="img" aria-label={copy.appAria}>
          <div className="lp-phone__screen" aria-hidden="true">
            <div className="lp-app__top">
              <span>{copy.greeting}</span>
              <b>{copy.storeName}</b>
            </div>
            <div className="lp-app__banner">
              <strong>{copy.heroTitle}</strong>
              <span className="lp-store__cta">{copy.heroCta}</span>
            </div>
            <b className="lp-store__label">{copy.featured}</b>
            <ul className="lp-app__grid">
              {copy.products.slice(0, 2).map((product, index) => (
                <li key={product}>
                  <span className={`lp-store__thumb lp-store__thumb--${index + 1}`} />
                  <span>{product}</span>
                </li>
              ))}
            </ul>
            <div className="lp-app__tabs">
              {[House, LayoutGrid, ShoppingBag, User].map((Icon, index) => (
                <span key={copy.tabs[index]} data-active={index === 0 ? '' : undefined}>
                  <Icon size={14} strokeWidth={1.9} />
                  {copy.tabs[index]}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

import { describe, expect, it } from 'vitest';
import { buildStationCatalog } from './catalog';
import { nozzle, product, pump, station, tank } from './__fixtures__';

const A = station('a');

describe('buildStationCatalog — dispensable products come only from real nozzle mappings', () => {
  it('shows a product only when an active nozzle→pump→tank chain exists in the station', () => {
    const catalog = buildStationCatalog({
      station: A,
      products: [product('p1', 'Alpha Fuel'), product('p2', 'Beta Fuel')],
      pumps: [pump('pump1', 'a')],
      tanks: [tank('t1', 'a', 'p1')],
      nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
    });
    expect(catalog.products.map((entry) => entry.product.id)).toEqual(['p1']);
    // المنتج الذي لا فوهة له في المحطة ليس «قابلاً للتعبئة» بل حالة تكوين.
    expect(catalog.unmappedProducts.map((entry) => entry.id)).toEqual(['p2']);
  });

  it('derives the catalog from the tenant data, with no built-in fuel names', () => {
    const catalog = buildStationCatalog({
      station: A,
      products: [product('x1', 'Premium-X'), product('x2', 'Ultra-Y'), product('x3', 'Heavy-Z'), product('x4', 'Extra-W')],
      pumps: [pump('pump1', 'a'), pump('pump2', 'a')],
      tanks: [tank('t1', 'a', 'x1'), tank('t2', 'a', 'x2'), tank('t3', 'a', 'x3'), tank('t4', 'a', 'x4')],
      nozzles: [
        nozzle('n1', 'a', 'pump1', 't1', 'x1'), nozzle('n2', 'a', 'pump1', 't2', 'x2'),
        nozzle('n3', 'a', 'pump2', 't3', 'x3'), nozzle('n4', 'a', 'pump2', 't4', 'x4'),
      ],
    });
    expect(catalog.products.map((entry) => entry.product.name)).toEqual(['Premium-X', 'Ultra-Y', 'Heavy-Z', 'Extra-W']);
    expect(catalog.products).toHaveLength(4);
  });

  it.each([
    ['nozzle_inactive', { nozzleStatus: 'inactive' }],
    ['nozzle_inactive', { nozzleStatus: 'maintenance' }],
    ['pump_inactive', { pumpStatus: 'inactive' }],
    ['tank_inactive', { tankStatus: 'maintenance' }],
    ['product_inactive', { productActive: false }],
  ] as const)('blocks dispensing (%s)', (reason, flags) => {
    const f = flags as { nozzleStatus?: string; pumpStatus?: string; tankStatus?: string; productActive?: boolean };
    const catalog = buildStationCatalog({
      station: A,
      products: [product('p1', 'Alpha', { is_active: f.productActive ?? true })],
      pumps: [pump('pump1', 'a', { status: f.pumpStatus ?? 'active' })],
      tanks: [tank('t1', 'a', 'p1', { status: f.tankStatus ?? 'active' })],
      nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1', { status: f.nozzleStatus ?? 'active' })],
    });
    expect(catalog.products).toEqual([]);
    expect(catalog.pumps[0].nozzles[0].blockedBy).toBe(reason);
  });

  it('refuses a nozzle whose product disagrees with its tank product', () => {
    const catalog = buildStationCatalog({
      station: A,
      products: [product('p1', 'Alpha'), product('p2', 'Beta')],
      pumps: [pump('pump1', 'a')],
      tanks: [tank('t1', 'a', 'p2')],
      nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
    });
    expect(catalog.products).toEqual([]);
    expect(catalog.pumps[0].nozzles[0].blockedBy).toBe('product_tank_mismatch');
  });

  it('treats an inactive station as not dispensing at all', () => {
    const catalog = buildStationCatalog({
      station: station('a', { status: 'maintenance' }),
      products: [product('p1', 'Alpha')],
      pumps: [pump('pump1', 'a')],
      tanks: [tank('t1', 'a', 'p1')],
      nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1')],
    });
    expect(catalog.products).toEqual([]);
    expect(catalog.pumps[0].nozzles[0].blockedBy).toBe('station_inactive');
  });

  it('ignores assets that belong to another station, even if the server sent them', () => {
    const catalog = buildStationCatalog({
      station: A,
      products: [product('p1', 'Alpha')],
      pumps: [pump('pumpB', 'b')],
      tanks: [tank('tB', 'b', 'p1')],
      nozzles: [nozzle('nB', 'b', 'pumpB', 'tB', 'p1')],
    });
    expect(catalog.products).toEqual([]);
    expect(catalog.pumps).toEqual([]);
    expect(catalog.tanks).toEqual([]);
    expect(catalog.unmappedProducts.map((entry) => entry.id)).toEqual(['p1']);
  });

  it('does not accept a pump or tank from another station even if ids match the nozzle', () => {
    const catalog = buildStationCatalog({
      station: A,
      products: [product('p1', 'Alpha')],
      pumps: [pump('pumpB', 'b')],
      tanks: [tank('tB', 'b', 'p1')],
      nozzles: [nozzle('n1', 'a', 'pumpB', 'tB', 'p1')],
    });
    expect(catalog.products).toEqual([]);
    expect(catalog.pumps).toEqual([]);
    expect(catalog.pumps.flatMap((entry) => entry.nozzles)).toEqual([]);
  });

  it('groups several nozzles/pumps/tanks under one product and counts them', () => {
    const catalog = buildStationCatalog({
      station: A,
      products: [product('p1', 'Alpha')],
      pumps: [pump('pump1', 'a'), pump('pump2', 'a')],
      tanks: [tank('t1', 'a', 'p1'), tank('t2', 'a', 'p1')],
      nozzles: [nozzle('n1', 'a', 'pump1', 't1', 'p1'), nozzle('n2', 'a', 'pump2', 't1', 'p1'), nozzle('n3', 'a', 'pump2', 't2', 'p1')],
    });
    const [entry] = catalog.products;
    expect(entry.nozzles).toHaveLength(3);
    expect(entry.pumpIds.sort()).toEqual(['pump1', 'pump2']);
    expect(entry.tankIds.sort()).toEqual(['t1', 't2']);
  });
});

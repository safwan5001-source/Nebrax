import type { PaperSizeId } from '../types';

export interface PaperSize {
  id: PaperSizeId;
  label: string;
  widthMm: number;
  /** 0 = ارتفاع مفتوح (إيصالات حرارية). */
  heightMm: number;
  orientation: 'portrait' | 'landscape';
}

export const PAPER_SIZES: Record<PaperSizeId, PaperSize> = {
  a4:           { id: 'a4',           label: 'A4',           widthMm: 210, heightMm: 297, orientation: 'portrait' },
  a4_landscape: { id: 'a4_landscape', label: 'A4 Landscape', widthMm: 297, heightMm: 210, orientation: 'landscape' },
  a5:           { id: 'a5',           label: 'A5',           widthMm: 148, heightMm: 210, orientation: 'portrait' },
  a5_landscape: { id: 'a5_landscape', label: 'A5 Landscape', widthMm: 210, heightMm: 148, orientation: 'landscape' },
  a6:           { id: 'a6',           label: 'A6',           widthMm: 105, heightMm: 148, orientation: 'portrait' },
  a6_landscape: { id: 'a6_landscape', label: 'A6 Landscape', widthMm: 148, heightMm: 105, orientation: 'landscape' },
  letter:       { id: 'letter',       label: 'Letter',       widthMm: 216, heightMm: 279, orientation: 'portrait' },
  legal:        { id: 'legal',        label: 'Legal',        widthMm: 216, heightMm: 356, orientation: 'portrait' },
  thermal_58:   { id: 'thermal_58',   label: '58mm',         widthMm: 58,  heightMm: 0,   orientation: 'portrait' },
  thermal_80:   { id: 'thermal_80',   label: '80mm',         widthMm: 80,  heightMm: 0,   orientation: 'portrait' },
};

export const DEFAULT_PAPER: PaperSizeId = 'a4';

import type { PublicPlan } from './catalog';

/** 🇫🇷 from "FR"; a globe for regions / global coverage. */
export function flagEmoji(type: string, code: string): string {
  if (type !== 'country' || !/^[A-Za-z]{2}$/.test(code)) return type === 'global' ? '🌐' : '🌍';
  const base = 0x1f1e6;
  const up = code.toUpperCase();
  return String.fromCodePoint(base + up.charCodeAt(0) - 65, base + up.charCodeAt(1) - 65);
}

export function formatGb(gb: number): string {
  return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

export function dataLabel(p: Pick<PublicPlan, 'dataType' | 'dataGb' | 'dailyDataGb'>): string {
  if (p.dataType === 'daily') return p.dailyDataGb ? `${formatGb(p.dailyDataGb)} / day` : 'Daily data';
  return p.dataGb ? formatGb(p.dataGb) : 'Data';
}

export function daysLabel(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function destinationPath(code: string): string {
  return `/esim/${encodeURIComponent(code.toLowerCase())}`;
}

export function planPath(sku: string): string {
  return `/plan/${encodeURIComponent(sku)}`;
}

const regionNames = typeof Intl !== 'undefined' && 'DisplayNames' in Intl ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
export function countryName(code: string): string {
  try {
    return regionNames?.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Black or white text, whichever reads better on `hex` (WCAG relative luminance). */
export function readableTextOn(hex: string): '#000000' | '#ffffff' {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return lum > 0.4 ? '#000000' : '#ffffff';
}

// 4K poster export: the live view is captured at 3840×2160 (see
// exportBridge), then title, legend and attribution are composed on a 2D
// canvas — the interactive UI never appears in the file.

import type { MetricStats, SculptureMode } from '@datenriff/data-contracts';
import {
  legendGradient,
  resolveDivergingHalfWidth,
  resolveSequentialDomain,
} from '@datenriff/color-scales';
import type { SceneData } from '../data/loader';
import { metricDefinition } from '../data/loader';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import { EXPORT_HEIGHT as H, EXPORT_WIDTH as W } from './exportBridge';
import { effectiveColorScale } from './targets';

const PAPER = '#f7f0ea';
const INK = '#221c15';
const MARGIN = 120;

export interface PosterContext {
  scene: SceneData;
  mode: SculptureMode;
  palette: string | null;
  colorStats: MetricStats;
}

/** Compose the captured frame into a poster and trigger the download. */
export async function composePoster(
  base: HTMLCanvasElement,
  ctx: PosterContext,
): Promise<void> {
  await document.fonts.ready;

  const composed = document.createElement('canvas');
  composed.width = W;
  composed.height = H;
  const c = composed.getContext('2d');
  if (!c) throw new Error('2D canvas unavailable');

  c.fillStyle = PAPER;
  c.fillRect(0, 0, W, H);
  c.drawImage(base, 0, 0, W, H);
  drawOverlay(c, ctx);

  const blob = await new Promise<Blob | null>((resolve) =>
    composed.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('PNG encoding failed');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vertical-atlas-${ctx.mode.id}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function drawOverlay(c: CanvasRenderingContext2D, ctx: PosterContext): void {
  const { mode, scene } = ctx;
  c.textBaseline = 'alphabetic';

  // header, top right
  const right = W - MARGIN;
  c.fillStyle = INK;
  c.globalAlpha = 0.6;
  c.font = '600 30px Inter, sans-serif';
  c.textAlign = 'right';
  drawTracked(c, 'VERTICAL ATLAS — GERMANY', right, MARGIN + 10, 10);
  c.globalAlpha = 1;
  c.font = '400 190px "Instrument Serif", Georgia, serif';
  c.fillText(mode.label.toUpperCase(), right, MARGIN + 190);
  c.globalAlpha = 0.62;
  c.font = '400 40px Inter, sans-serif';
  c.fillText(mode.subtitle ?? '', right, MARGIN + 262);
  c.globalAlpha = 0.38;
  c.font = '500 28px Inter, sans-serif';
  drawTracked(c, formatDate(mode.attribution?.referenceDate), right, MARGIN + 322, 4);
  c.globalAlpha = 1;

  drawLegend(c, ctx, right, H - MARGIN);

  // attribution, bottom left
  c.textAlign = 'left';
  c.globalAlpha = 0.45;
  c.font = '500 26px Inter, sans-serif';
  drawTracked(c, scene.dataset.source.label.toUpperCase(), MARGIN, H - MARGIN - 44, 2.2);
  drawTracked(c, 'DATENRIFF · VERTICAL ATLAS', MARGIN, H - MARGIN, 2.2);
  c.globalAlpha = 1;
}

function drawLegend(
  c: CanvasRenderingContext2D,
  ctx: PosterContext,
  right: number,
  bottom: number,
): void {
  const scale = effectiveColorScale(ctx.mode, ctx.palette);
  const def = metricDefinition(ctx.scene.dataset, ctx.mode.colorMetric);
  const title =
    ctx.mode.colorMetric === CHANGE_PCT_METRIC ? 'Population change' : def.label;

  c.textAlign = 'right';
  c.fillStyle = INK;
  c.globalAlpha = 0.55;
  c.font = '600 26px Inter, sans-serif';
  drawTracked(c, (title ?? '').toUpperCase(), right, bottom - 250, 5);
  c.globalAlpha = 1;

  if (scale.type === 'categorical') {
    const labels = def.categories ?? [];
    const colors = legendGradient(scale.palette);
    c.font = '500 30px Inter, sans-serif';
    const rowH = 52;
    labels.forEach((label, i) => {
      const y = bottom - 190 + (i % 5) * rowH;
      const col = Math.floor(i / 5);
      const x = right - col * 420;
      c.fillStyle = colors[i] ?? '#999';
      c.fillRect(x - 360, y - 26, 30, 30);
      c.fillStyle = INK;
      c.globalAlpha = 0.8;
      c.textAlign = 'left';
      c.fillText(label, x - 316, y);
      c.globalAlpha = 1;
    });
    c.textAlign = 'right';
    return;
  }

  // gradient bar
  const barW = 620;
  const barY = bottom - 200;
  const gradient = c.createLinearGradient(right - barW, 0, right, 0);
  const stops = legendGradient(scale.palette);
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
  c.fillStyle = gradient;
  c.fillRect(right - barW, barY, barW, 26);

  c.fillStyle = INK;
  c.globalAlpha = 0.6;
  c.font = '500 28px Inter, sans-serif';
  if (scale.type === 'diverging') {
    const hw = resolveDivergingHalfWidth(scale, ctx.colorStats);
    c.textAlign = 'left';
    c.fillText(`−${Math.round(hw * 100)} %`, right - barW, barY + 66);
    c.textAlign = 'center';
    c.fillText('0', right - barW / 2, barY + 66);
    c.textAlign = 'right';
    c.fillText(`+${Math.round(hw * 100)} %`, right, barY + 66);
  } else {
    const [lo, hi] = resolveSequentialDomain(scale, ctx.colorStats);
    c.textAlign = 'left';
    c.fillText(formatNumber(lo, def.unit), right - barW, barY + 66);
    c.textAlign = 'right';
    c.fillText(formatNumber(hi, def.unit), right, barY + 66);
  }
  c.globalAlpha = 1;
}

/** Letter-spaced text; canvas has no letter-spacing in every browser. */
function drawTracked(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): void {
  const chars = [...text];
  const widths = chars.map((ch) => c.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1);
  let cx = c.textAlign === 'right' ? x - total : c.textAlign === 'center' ? x - total / 2 : x;
  const align = c.textAlign;
  c.textAlign = 'left';
  chars.forEach((ch, i) => {
    c.fillText(ch, cx, y);
    cx += widths[i]! + tracking;
  });
  c.textAlign = align;
}

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

function formatNumber(v: number, unit?: string): string {
  if (unit === '€/m²') return `${v} €/m²`;
  return Math.abs(v) >= 10_000 ? `${nf.format(Math.round(v / 1000))}k` : nf.format(v);
}

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  const months = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// 4K poster export: the live view is captured at 1920×1080 CSS px rendered
// at 2× (see exportBridge), then title, legend and attribution are composed
// on a 3840×2160 canvas — the interactive UI never appears in the file.

import type { MetricStats, SculptureMode } from '@datenriff/data-contracts';
import {
  legendGradient,
  resolveDivergingHalfWidth,
  resolveSequentialDomain,
} from '@datenriff/color-scales';
import type { SceneData } from '../data/loader';
import { metricForScene } from '../data/loader';
import { LOCALE, type Lang, metricText, modeText, translate } from '../i18n/strings';
import { intFormat } from '../i18n/format';
import { nearestStep } from '../modes/time';
import { CHANGE_PCT_METRIC } from '../modes/modes';
import { EXPORT_DPR, currentFormat, type ExportFormat } from './exportBridge';
import { effectiveColorScale } from './targets';
import { licenceRef } from '../data/licences';
import type { BkgCredit } from '../state/store';

const PAPER = '#f7f0ea';
const INK = '#221c15';

export interface PosterContext {
  scene: SceneData;
  mode: SculptureMode;
  palette: string | null;
  /** The step on screen. A poster of 2012 was carrying the latest year's
   *  legend, because the poster read the mode's base colour metric. */
  timeT: number;
  /** The language on screen. The poster was always English. */
  lang: Lang;
  colorStats: MetricStats;
  /** BKG boundary credit. Owed on every poster, not only where a border is
   *  drawn: the country ring the raster pipelines clip to is VG2500. */
  boundaryCredit?: BkgCredit | null;
}

/** Compose the captured frame into the poster: paper, sculpture, then title,
 *  legend and attribution. `dpr` scales the whole composition, so the same
 *  code draws the 4K file and the dialog's small preview. */
export async function renderPoster(
  base: HTMLCanvasElement,
  ctx: PosterContext,
  format: ExportFormat = currentFormat(),
  dpr = EXPORT_DPR,
): Promise<HTMLCanvasElement> {
  await document.fonts.ready;
  const W = Math.round(format.width * dpr);
  const H = Math.round(format.height * dpr);
  // portrait crops have far less width for the header block
  const MARGIN = Math.round(Math.min(W, H) * 0.055);

  const composed = document.createElement('canvas');
  composed.width = W;
  composed.height = H;
  const c = composed.getContext('2d');
  if (!c) throw new Error('2D canvas unavailable');

  c.fillStyle = PAPER;
  c.fillRect(0, 0, W, H);
  c.drawImage(base, 0, 0, W, H);
  drawOverlay(c, ctx, W, H, MARGIN);
  return composed;
}

/** Compose the captured frame into a poster and trigger the download. */
export async function composePoster(
  base: HTMLCanvasElement,
  ctx: PosterContext,
  dpr = EXPORT_DPR,
): Promise<void> {
  const format = currentFormat();
  const composed = await renderPoster(base, ctx, format, dpr);
  const blob = await new Promise<Blob | null>((resolve) =>
    composed.toBlob(resolve, 'image/png'),
  );
  if (!blob) throw new Error('PNG encoding failed');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vertical-atlas-${ctx.mode.id}-${format.id}.png`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function drawOverlay(
  c: CanvasRenderingContext2D,
  ctx: PosterContext,
  W: number,
  H: number,
  MARGIN: number,
): void {
  const { mode } = ctx;
  // type scales with the frame so 9:16 does not get poster-sized headlines
  const u = Math.min(W, H) / 2160;
  c.textBaseline = 'alphabetic';

  // masthead, centred — the same lockup the screen carries, so a printed
  // poster and the app do not disagree about what this is called
  const right = W - MARGIN;
  c.fillStyle = INK;
  c.textAlign = 'center';
  c.font = `400 ${56 * u}px "Instrument Serif", Georgia, serif`;
  const markWidth = drawTracked(c, 'DATENRIFF', W / 2, MARGIN + 46 * u, 37 * u);
  c.globalAlpha = 0.4;
  c.font = `600 ${22 * u}px Inter, sans-serif`;
  // tracked to the width of the name above it, as on screen
  drawTrackedToWidth(c, 'VERTICAL ATLAS — GERMANY', W / 2, MARGIN + 86 * u, markWidth);
  c.globalAlpha = 1;
  c.textAlign = 'right';
  c.font = `400 ${190 * u}px "Instrument Serif", Georgia, serif`;
  const text = modeText(ctx.lang, mode.id, { label: mode.label, subtitle: mode.subtitle });
  c.fillText(text.label.toUpperCase(), right, MARGIN + 190 * u);
  c.globalAlpha = 0.62;
  c.font = `400 ${40 * u}px Inter, sans-serif`;
  c.fillText(text.subtitle ?? '', right, MARGIN + 262 * u);
  c.globalAlpha = 0.38;
  c.font = `500 ${28 * u}px Inter, sans-serif`;
  drawTracked(
    c,
    formatDate(shownDate(mode, ctx.timeT), ctx.lang),
    right,
    MARGIN + 322 * u,
    4 * u,
  );
  c.globalAlpha = 1;

  drawLegend(c, ctx, right, H - MARGIN, u);

  // The credit stays on the poster: it is a licence condition, and a poster
  // travels further than the page it came from — which is exactly why it
  // needs the whole source note and not just the publisher's name. Paper
  // cannot hyperlink, so the licence and the dataset URI are printed.
  c.textAlign = 'left';
  c.globalAlpha = 0.45;
  c.font = `500 ${26 * u}px Inter, sans-serif`;
  // The note is long — three addresses on the boundary line alone — and a
  // 9:16 crop is half as wide as a 16:9 one, so it is wrapped to the frame
  // rather than allowed to run off the paper.
  const lines = sourceNoteLines(ctx).flatMap((line) => wrapNote(c, line, W - 2 * MARGIN, 2.2 * u));
  const step = 34 * u;
  lines.forEach((line, i) => {
    drawTracked(c, line, MARGIN, H - MARGIN - (lines.length - 1 - i) * step, 2.2 * u);
  });
  c.globalAlpha = 1;
}

/** Break one note line to `width`, preferring the separators the note is
 *  already built from so a URL is never split down the middle. */
function wrapNote(
  c: CanvasRenderingContext2D,
  line: string,
  width: number,
  tracking: number,
): string[] {
  const fits = (s: string) => c.measureText(s).width + tracking * Math.max(0, s.length - 1) <= width;
  if (fits(line)) return [line];
  const parts = line.split(/(?<=·)\s+|\s+(?=·)/).filter((p) => p.trim() !== '·');
  const out: string[] = [];
  let current = '';
  for (const part of parts) {
    const next = current ? `${current} ${part}` : part;
    if (current && !fits(next)) {
      out.push(current);
      current = part;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Strip the scheme: a printed URL is read, not clicked, and "https://"
 *  costs a fifth of the line for nothing. */
const bare = (url: string) => url.replace(/^https?:\/\//, '');

/** The source note, printed rather than linked.
 *
 *  DL-DE-BY-2.0 §2 wants the provider, the licence annotation *with a
 *  reference to the licence text*, and the dataset URI; §3 wants the note
 *  that the data was changed. CC BY 4.0 §3(a)(1)(C) likewise wants the text
 *  of the licence or a URI to it. On a web page those references are the
 *  links under the words; on paper there is nothing to click, so both
 *  addresses are printed. The boundary credit is owed on every poster: the
 *  country ring every raster pipeline is clipped to comes from VG2500. */
export function sourceNoteLines(ctx: PosterContext): string[] {
  const { scene, lang } = ctx;
  const source = scene.dataset.source;
  const licence = licenceRef(source.license);
  const modified = translate(lang, 'source.modified');
  // "dl-de/by-2-0" is one of the two forms the licence permits; it keeps its
  // case while the rest of the note takes the poster's uppercase.
  const prefix = translate(lang, 'source.prefix').replace(/:\s*$/, '');
  const name = source.label.replace(/^Data:\s*/, '');
  const parts = [`${prefix}: ${name}`.toUpperCase(), licence?.short, modified.toUpperCase()];
  const lines = [parts.filter(Boolean).join(' · ')];
  // the dataset's page, not the download it came from: a poster cannot be
  // clicked, and the landing page outlives any one file name
  const uri = source.url ?? source.provenance?.sourceUrl;
  const addresses = [uri, licence?.url].filter(Boolean) as string[];
  if (addresses.length) lines.push(addresses.map(bare).join('  ·  '));
  const bkg = ctx.boundaryCredit;
  if (bkg) {
    const bkgLicence = licenceRef(bkg.license);
    lines.push(
      [
        (translate(lang, 'source.boundaries') + ': ' + bkg.attribution).toUpperCase(),
        bkgLicence?.short,
        modified.toUpperCase(),
      ]
        .filter(Boolean)
        .join(' · '),
    );
    const bkgAddresses = [bkg.url, bkgLicence?.url, bkg.sourcesUrl].filter(Boolean) as string[];
    if (bkgAddresses.length) lines.push(bkgAddresses.map(bare).join('  ·  '));
  }
  return lines;
}

/** The colour metric of the step on screen, matching what the legend does. */
export function shownColorMetric(mode: SculptureMode, timeT: number): string {
  if (!mode.time) return mode.colorMetric;
  const template =
    mode.time.colorMetricTemplate ??
    (mode.colorMetric === mode.heightMetric ? mode.time.metricTemplate : undefined);
  if (!template) return mode.colorMetric;
  return template.replace('{step}', mode.time.steps[nearestStep(timeT, mode.time.steps.length)]!);
}

/** The year the poster is of, when the mode has a timeline. */
function shownDate(mode: SculptureMode, timeT: number): string | undefined {
  if (mode.time) {
    const step = mode.time.steps[nearestStep(timeT, mode.time.steps.length)];
    if (step && /^\d{4}$/.test(step)) return `${step}-12-31`;
  }
  return mode.attribution?.referenceDate;
}

function drawLegend(
  c: CanvasRenderingContext2D,
  ctx: PosterContext,
  right: number,
  bottom: number,
  u: number,
): void {
  const scale = effectiveColorScale(ctx.mode, ctx.palette);
  const metricId = shownColorMetric(ctx.mode, ctx.timeT);
  const def = metricForScene(ctx.scene, metricId);
  const title =
    ctx.mode.colorMetric === CHANGE_PCT_METRIC
      ? translate(ctx.lang, 'legend.populationChange')
      : metricText(ctx.lang, metricId, def.label);

  c.textAlign = 'right';
  c.fillStyle = INK;
  c.globalAlpha = 0.55;
  c.font = `600 ${26 * u}px Inter, sans-serif`;
  drawTracked(c, (title ?? '').toUpperCase(), right, bottom - 250 * u, 5 * u);
  c.globalAlpha = 1;

  if (scale.type === 'categorical') {
    const labels = def.categories ?? [];
    const colors = legendGradient(scale.palette);
    c.font = `500 ${30 * u}px Inter, sans-serif`;
    const rowH = 52 * u;
    labels.forEach((label, i) => {
      const y = bottom - 190 * u + (i % 5) * rowH;
      const col = Math.floor(i / 5);
      const x = right - col * 420 * u;
      c.fillStyle = colors[i] ?? '#999';
      c.fillRect(x - 360 * u, y - 26 * u, 30 * u, 30 * u);
      c.fillStyle = INK;
      c.globalAlpha = 0.8;
      c.textAlign = 'left';
      c.fillText(label, x - 316 * u, y);
      c.globalAlpha = 1;
    });
    c.textAlign = 'right';
    return;
  }

  // gradient bar
  const barW = 620 * u;
  const barY = bottom - 200 * u;
  const gradient = c.createLinearGradient(right - barW, 0, right, 0);
  const stops = legendGradient(scale.palette);
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
  c.fillStyle = gradient;
  c.fillRect(right - barW, barY, barW, 26 * u);

  c.fillStyle = INK;
  c.globalAlpha = 0.6;
  c.font = `500 ${28 * u}px Inter, sans-serif`;
  if (scale.type === 'diverging') {
    const hw = resolveDivergingHalfWidth(scale, ctx.colorStats);
    c.textAlign = 'left';
    c.fillText(`−${Math.round(hw * 100)} %`, right - barW, barY + 66 * u);
    c.textAlign = 'center';
    c.fillText('0', right - barW / 2, barY + 66 * u);
    c.textAlign = 'right';
    c.fillText(`+${Math.round(hw * 100)} %`, right, barY + 66 * u);
  } else {
    const [lo, hi] = resolveSequentialDomain(scale, ctx.colorStats);
    c.textAlign = 'left';
    c.fillText(formatNumber(ctx.lang, lo, def.unit, def.aggregation), right - barW, barY + 66 * u);
    c.textAlign = 'right';
    c.fillText(formatNumber(ctx.lang, hi, def.unit, def.aggregation), right, barY + 66 * u);
  }
  c.globalAlpha = 1;
}

/** Letter-spaced text; canvas has no letter-spacing in every browser. */
/** Letter-spaced text; returns the width it drew, which the masthead needs
 *  to line its two rows up. */
function drawTrackedToWidth(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  target: number,
): number {
  const chars = [...text];
  const bare = chars.reduce((sum, ch) => sum + c.measureText(ch).width, 0);
  const tracking = chars.length > 1 ? (target - bare) / (chars.length - 1) : 0;
  return drawTracked(c, text, x, y, tracking);
}

function drawTracked(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  tracking: number,
): number {
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
  return total;
}

/** Same rule as the screen legend: a share reads as a percentage, anything
 *  else prints the unit the pipeline declared. The poster follows the
 *  language on screen — an English poster gets English digit grouping. */
function formatNumber(lang: Lang, v: number, unit?: string, aggregation?: string): string {
  const nf = intFormat(LOCALE[lang]);
  if (aggregation === 'share') return `${nf.format(Math.round(v * 100))} %`;
  const compact = Math.abs(v) >= 10_000 ? `${nf.format(Math.round(v / 1000))}k` : nf.format(v);
  return unit ? `${compact} ${unit}` : compact;
}

const MONTHS: Record<Lang, string[]> = {
  en: 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' '),
  de: 'JAN FEB MÄR APR MAI JUN JUL AUG SEP OKT NOV DEZ'.split(' '),
};

function formatDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[lang][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

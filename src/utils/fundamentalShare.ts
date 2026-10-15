// Fundamental Analysis card: save it as a picture (to the phone's gallery), share it, or post a short version on X.
// The picture is drawn on a canvas (4:5 portrait, 1080x1350 at 2x) from the read itself: the forecast before the release,
// and the released result (actual vs forecast, and what the read said before) once a recheck finds it out.
import type { FundamentalReport } from './fundamental';
import { X_POST_LIMIT, xLength } from './shareText';
import { exactPrice } from './formatPrice';

const SANS = '"Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

const num = (s?: string) => {
  const m = /-?\d+(?:\.\d+)?/.exec(String(s || '').replace(/,/g, ''));
  return m ? Number(m[0]) : null;
};
/** Above / below / in line with the forecast */
export function versusForecast(actual?: string, forecast?: string): 'ABOVE' | 'BELOW' | 'IN_LINE' | null {
  const a = num(actual);
  const f = num(forecast);
  if (a === null || f === null) return null;
  return Math.abs(a - f) < 1e-9 ? 'IN_LINE' : a > f ? 'ABOVE' : 'BELOW';
}
const VS_TEXT = { ABOVE: 'above forecast', BELOW: 'below forecast', IN_LINE: 'in line with forecast' } as const;
/** What the read said before the release (kept on a recheck that found it out) */
export function earlierCall(r: FundamentalReport): string {
  const l = (r.recheck?.lines || []).find(x => /^Your earlier read expected: /.test(String(x)));
  return l ? String(l).replace(/^Your earlier read expected: /, '') : '';
}
const isReleased = (r: FundamentalReport) => !!r.data?.actual;
const impactWord = (r: FundamentalReport) => (r.mostLikely.impact === 'BULLISH' ? `bullish ${r.currency}` : r.mostLikely.impact === 'BEARISH' ? `bearish ${r.currency}` : `neutral ${r.currency}`).trim();
const fileBase = (r: FundamentalReport) => `MarketX_${r.event.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50)}`;

// ---------------------------------------------------------------------------
// X post: brief, key points only, always within X's limit (least important lines go first)
// ---------------------------------------------------------------------------
export function buildFundamentalShareText(r: FundamentalReport, origin = 'https://marketx.world'): string {
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  const forPairs = r.pairs.filter(p => p.bias === 'FOR').slice(0, 3).map(p => p.symbol);
  const against = r.pairs.filter(p => p.bias === 'AGAINST').slice(0, 3).map(p => p.symbol);
  const when = r.releaseAt ? new Date(r.releaseAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : r.releaseText;
  // [text, priority]: higher priority stays longer
  const lines: Array<[string, number]> = [];
  if (isReleased(r)) {
    const vs = versusForecast(r.data.actual, r.data.forecast);
    lines.push([`📊 ${clip(r.event, 60)} is out: ${r.data.actual}${r.data.forecast ? ` vs ${r.data.forecast} forecast` : ''}${vs && vs !== 'IN_LINE' ? ` (${vs === 'ABOVE' ? 'beat' : 'miss'})` : ''}`, 10]);
    const before = earlierCall(r);
    if (before) lines.push([`MarketX read before the release: ${clip(before, 80)}`, 8]);
    lines.push([`Now: ${clip(r.mostLikely.outcome, 70)} (${r.mostLikely.probability}%), ${impactWord(r)}`, 7]);
  } else {
    lines.push([`📊 ${clip(r.event, 60)}${when ? `, ${when}` : ''}`, 10]);
    lines.push([`Most likely: ${clip(r.mostLikely.outcome, 80)} (${r.mostLikely.probability}%) → ${impactWord(r)}`, 9]);
    const fig = [r.data.forecast && `Forecast ${r.data.forecast}`, r.data.previous && `Prev ${r.data.previous}`].filter(Boolean).join(' · ');
    if (fig) lines.push([fig, 5]);
  }
  if (forPairs.length) lines.push([`🟢 For: ${forPairs.join(', ')}`, 6]);
  if (against.length) lines.push([`🔴 Against: ${against.join(', ')}`, 6]);
  lines.push([`Fundamental read by @_MarketX`, 4]);
  lines.push([origin.replace(/\/+$/, ''), 3]);
  let kept = lines.slice();
  const text = () => kept.map(l => l[0]).join('\n');
  while (xLength(text()) > X_POST_LIMIT && kept.length > 1) {
    const low = kept.reduce((m, l, i) => (l[1] < kept[m][1] ? i : m), 0);
    kept = kept.filter((_, i) => i !== low);
  }
  return text();
}

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------
function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
/** Wraps text into at most `max` lines that fit `width` (the last one ends with … when cut) */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= width) cur = t;
    else {
      if (cur) out.push(cur);
      cur = w;
      if (out.length === max) break;
    }
  }
  if (out.length < max && cur) out.push(cur);
  if (out.length > max) out.length = max;
  const used = out.join(' ').split(/\s+/).length;
  if (used < words.length && out.length) {
    let last = out[out.length - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    out[out.length - 1] = `${last.trimEnd()}…`;
  }
  return out;
}

// The picture is drawn ahead (when the trader reaches for the buttons), so the share sheet opens straight from the tap:
// some phones refuse a share that starts long after the tap
const cache = new Map<string, Promise<Blob | null>>();
export function prepareFundamentalCard(r: FundamentalReport, username?: string, isVerified?: boolean): Promise<Blob | null> {
  const key = JSON.stringify([r.generatedAt, r.event, r.data, r.recheck?.checkedAt, r.mostLikely, username || '', !!isVerified]);
  let job = cache.get(key);
  if (!job) {
    job = renderFundamentalCard(r, username, isVerified).catch(() => null);
    cache.set(key, job);
    job.then(b => { if (!b) cache.delete(key); });
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  }
  return job;
}

export async function renderFundamentalCard(r: FundamentalReport, username?: string, isVerified?: boolean): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const S = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(S, S);
  try {
    await Promise.all([document.fonts?.load(`700 40px "Geist"`), document.fonts?.load(`500 20px "Geist Mono"`)]);
  } catch {}
  const logo = await loadImage('/brand/marketx-logo-256.png?v=3');
  const released = isReleased(r);
  const bull = r.mostLikely.impact === 'BULLISH';
  const bear = r.mostLikely.impact === 'BEARISH';
  const accent = bull ? '#34d399' : bear ? '#fb7185' : '#a1a1aa';
  const SKY = '#38bdf8';

  // Background
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(W * 0.85, H * 0.08, 10, W * 0.85, H * 0.08, 700);
  g1.addColorStop(0, 'rgba(56,189,248,0.16)');
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W * 0.05, H, 10, W * 0.05, H, 700);
  g2.addColorStop(0, 'rgba(245,158,11,0.10)');
  g2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  for (let x = 24; x < W; x += 28) for (let y = 24; y < H; y += 28) ctx.fillRect(x, y, 1.2, 1.2);
  rr(ctx, 14, 14, W - 28, H - 28, 30);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const L = 64;
  const R = W - 64;
  // Header
  if (logo) ctx.drawImage(logo, L, 52, 40, 40);
  ctx.textBaseline = 'middle';
  ctx.font = `700 26px ${SANS}`;
  ctx.fillStyle = '#fafafa';
  ctx.fillText('Market', L + 52, 73);
  ctx.fillStyle = '#a78bfa';
  ctx.fillText('X', L + 52 + ctx.measureText('Market').width, 73);
  ctx.font = `600 15px ${SANS}`;
  const tag = released ? 'FUNDAMENTAL RESULT' : 'FUNDAMENTAL FORECAST';
  const tw = ctx.measureText(tag).width + 30;
  rr(ctx, R - tw, 55, tw, 36, 18);
  ctx.fillStyle = 'rgba(56,189,248,0.14)';
  ctx.fill();
  ctx.fillStyle = '#7dd3fc';
  ctx.fillText(tag, R - tw + 15, 73);

  // Event
  let y = 150;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 50px ${SANS}`;
  ctx.fillStyle = '#fafafa';
  for (const line of wrap(ctx, r.event, R - L, 2)) {
    ctx.fillText(line, L, y + 40);
    y += 58;
  }
  // Chips: currency, status + time
  const when = r.releaseAt ? new Date(r.releaseAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : r.releaseText;
  ctx.font = `600 17px ${SANS}`;
  ctx.textBaseline = 'middle';
  let cx = L;
  const chip = (text: string, fg: string, bg: string) => {
    const w = ctx.measureText(text).width + 28;
    rr(ctx, cx, y + 6, w, 38, 19);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(text, cx + 14, y + 25);
    cx += w + 10;
  };
  if (r.currency) chip(r.currency, '#e4e4e7', 'rgba(255,255,255,0.08)');
  if (r.category) chip(r.category, '#a1a1aa', 'rgba(255,255,255,0.05)');
  chip(`${released ? 'Released' : r.status === 'UPCOMING' ? 'Upcoming' : 'Outlook'}${when ? ` · ${when}` : ''}`, released ? '#7dd3fc' : '#fcd34d', released ? 'rgba(56,189,248,0.14)' : 'rgba(245,158,11,0.14)');
  y += 76;

  // Result (once released): actual vs forecast, and what the read said before
  if (released) {
    const vs = versusForecast(r.data.actual, r.data.forecast);
    rr(ctx, L, y, R - L, 168, 24);
    ctx.fillStyle = 'rgba(56,189,248,0.08)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(56,189,248,0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 15px ${SANS}`;
    ctx.fillStyle = '#7dd3fc';
    ctx.fillText('ACTUAL', L + 28, y + 40);
    ctx.font = `700 54px ${MONO}`;
    ctx.fillStyle = '#fafafa';
    ctx.fillText(String(r.data.actual).slice(0, 18), L + 28, y + 100);
    ctx.font = `600 20px ${SANS}`;
    ctx.fillStyle = vs === 'ABOVE' ? '#7dd3fc' : vs === 'BELOW' ? '#fcd34d' : '#a1a1aa';
    ctx.fillText(`${vs ? VS_TEXT[vs].charAt(0).toUpperCase() + VS_TEXT[vs].slice(1) : 'Released'}${r.data.forecast ? ` (forecast ${r.data.forecast})` : ''}`, L + 28, y + 138);
    const before = earlierCall(r);
    if (before) {
      ctx.textAlign = 'right';
      ctx.font = `600 14px ${SANS}`;
      ctx.fillStyle = '#71717a';
      ctx.fillText('THE READ BEFORE THE RELEASE', R - 28, y + 40);
      ctx.font = `500 18px ${SANS}`;
      ctx.fillStyle = '#d4d4d8';
      wrap(ctx, before, 360, 3).forEach((l, i) => ctx.fillText(l, R - 28, y + 72 + i * 26));
      ctx.textAlign = 'left';
    }
    y += 192;
  }

  // Most likely
  rr(ctx, L, y, R - L, 200, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 15px ${SANS}`;
  ctx.fillStyle = SKY;
  ctx.fillText(released ? 'WHAT HAPPENS NEXT' : 'MOST LIKELY OUTCOME', L + 28, y + 40);
  ctx.textAlign = 'right';
  ctx.font = `700 56px ${MONO}`;
  ctx.fillStyle = SKY;
  ctx.fillText(`${r.mostLikely.probability}%`, R - 28, y + 74);
  ctx.textAlign = 'left';
  ctx.font = `700 30px ${SANS}`;
  ctx.fillStyle = '#fafafa';
  wrap(ctx, r.mostLikely.outcome, R - L - 230, 2).forEach((l, i) => ctx.fillText(l, L + 28, y + 86 + i * 38));
  rr(ctx, L + 28, y + 152, R - L - 56, 8, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  rr(ctx, L + 28, y + 152, Math.max(8, ((R - L - 56) * r.mostLikely.probability) / 100), 8, 4);
  const bar = ctx.createLinearGradient(L, 0, R, 0);
  bar.addColorStop(0, '#38bdf8');
  bar.addColorStop(1, '#67e8f9');
  ctx.fillStyle = bar;
  ctx.fill();
  ctx.font = `600 17px ${SANS}`;
  ctx.fillStyle = accent;
  ctx.fillText(`${bull ? '▲ ' : bear ? '▼ ' : ''}${impactWord(r).charAt(0).toUpperCase() + impactWord(r).slice(1)}`, L + 28, y + 186);
  y += 224;

  // Figures (before the release)
  if (!released) {
    const figs: Array<[string, string]> = [['ACTUAL', 'Pending'], ['FORECAST', r.data.forecast || '—'], ['PREVIOUS', r.data.previous || '—']];
    const fw = (R - L - 24) / 3;
    figs.forEach(([k, v], i) => {
      const x = L + i * (fw + 12);
      rr(ctx, x, y, fw, 96, 18);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.stroke();
      ctx.font = `600 13px ${SANS}`;
      ctx.fillStyle = '#71717a';
      ctx.fillText(k, x + 20, y + 34);
      ctx.font = `700 26px ${MONO}`;
      ctx.fillStyle = i === 0 ? '#fcd34d' : '#fafafa';
      ctx.fillText(v.slice(0, 14), x + 20, y + 74);
    });
    y += 120;
  }

  // Pairs
  const pairs = r.pairs.slice(0, 6);
  if (pairs.length) {
    ctx.font = `600 15px ${SANS}`;
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText('PAIRS IT MOVES', L, y + 10);
    y += 28;
    const pw = (R - L - 14) / 2;
    pairs.forEach((p, i) => {
      const x = L + (i % 2) * (pw + 14);
      const py = y + Math.floor(i / 2) * 82;
      rr(ctx, x, py, pw, 70, 16);
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.stroke();
      ctx.font = `700 24px ${SANS}`;
      ctx.fillStyle = '#fafafa';
      ctx.fillText(p.symbol, x + 20, py + 34);
      ctx.font = `500 15px ${MONO}`;
      ctx.fillStyle = '#71717a';
      ctx.fillText(p.price ? exactPrice(p.price) : '', x + 20, py + 56);
      const lab = p.bias === 'FOR' ? '▲ For' : p.bias === 'AGAINST' ? '▼ Against' : '• Neutral';
      ctx.font = `700 17px ${SANS}`;
      const lw = ctx.measureText(lab).width + 26;
      rr(ctx, x + pw - lw - 16, py + 17, lw, 36, 18);
      ctx.fillStyle = p.bias === 'FOR' ? 'rgba(52,211,153,0.15)' : p.bias === 'AGAINST' ? 'rgba(251,113,133,0.15)' : 'rgba(255,255,255,0.06)';
      ctx.fill();
      ctx.fillStyle = p.bias === 'FOR' ? '#6ee7b7' : p.bias === 'AGAINST' ? '#fda4af' : '#d4d4d8';
      ctx.textBaseline = 'middle';
      ctx.fillText(lab, x + pw - lw - 3, py + 36);
      ctx.textBaseline = 'alphabetic';
    });
    y += Math.ceil(pairs.length / 2) * 82;
  }

  // Footer
  const fy = H - 76;
  ctx.textBaseline = 'middle';
  ctx.font = `600 15px ${SANS}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText(`Confidence ${r.confidence}% · odds, never a certainty · not financial advice`, L, fy - 44);
  const handle = `@${(username || 'marketx_trader').replace(/^@/, '')}`;
  ctx.font = `600 22px ${SANS}`;
  ctx.fillStyle = '#e4e4e7';
  ctx.fillText(handle, L, fy);
  if (isVerified) {
    const hx = L + ctx.measureText(handle).width + 20;
    ctx.beginPath();
    ctx.arc(hx, fy, 11, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(hx - 5, fy);
    ctx.lineTo(hx - 1.5, fy + 3.6);
    ctx.lineTo(hx + 5, fy - 3.6);
    ctx.stroke();
  }
  ctx.font = `600 20px ${SANS}`;
  const site = 'marketx.world';
  const sw = ctx.measureText(site).width + 44;
  rr(ctx, R - sw, fy - 24, sw, 48, 24);
  ctx.fillStyle = '#fafafa';
  ctx.fill();
  ctx.fillStyle = '#09090b';
  ctx.fillText(site, R - sw + 22, fy + 1);

  return new Promise(resolve => (canvas.toBlob ? canvas.toBlob(b => resolve(b), 'image/png') : resolve(null)));
}

// ---------------------------------------------------------------------------
// Save and share
// ---------------------------------------------------------------------------
const isIOS = () => typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
const canShareFile = (file: File) => {
  try {
    return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
};
const downloadBlob = (blob: Blob, name: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60_000);
};

/**
 * Saves the card picture. iPhone/iPad: the share sheet (its "Save Image" puts it in Photos); everywhere else a download
 * (Android keeps it in Downloads, which the gallery shows). 'saved' | 'shared' | 'failed'.
 */
export async function saveFundamentalCard(r: FundamentalReport, username?: string, isVerified?: boolean): Promise<'saved' | 'shared' | 'cancelled' | 'failed'> {
  const blob = await prepareFundamentalCard(r, username, isVerified);
  if (!blob) return 'failed';
  const name = `${fileBase(r)}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (isIOS() && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: r.event });
      return 'shared';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'saved';
}

/** Shares the card picture with its short write-up (the device's share sheet); without one, copies the text and saves the picture */
export async function shareFundamentalCard(r: FundamentalReport, username?: string, isVerified?: boolean): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const text = buildFundamentalShareText(r, typeof window !== 'undefined' ? window.location.origin : undefined);
  const blob = await prepareFundamentalCard(r, username, isVerified);
  const file = blob ? new File([blob], `${fileBase(r)}.png`, { type: 'image/png' }) : null;
  try {
    if (file && canShareFile(file)) {
      await navigator.share({ files: [file], text, title: r.event });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ text, title: r.event });
      return 'shared';
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard?.writeText(text);
  } catch {}
  if (blob) downloadBlob(blob, `${fileBase(r)}.png`);
  return blob ? 'copied' : 'failed';
}

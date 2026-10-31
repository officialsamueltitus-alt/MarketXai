// Token safety card: a picture of the result (save to the device or share), plus a short text for X.
// Drawn on a canvas in the site's colours (dark page, violet accent, the verdict's own colour for the score).
import type { TokenSafety } from '../types';
import { X_POST_LIMIT, xLength } from './shareText';
import { canShareFile, downloadBlob, isIOS, loadImage, rr, wrapText } from './fundamentalShare';

const SANS = '"Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';

const VERDICT = {
  LOW_RISK: { label: 'LOW RISK', color: '#34d399' },
  CAUTION: { label: 'CAUTION', color: '#fbbf24' },
  HIGH_RISK: { label: 'HIGH RISK', color: '#fb7185' },
  UNKNOWN: { label: 'NOT CHECKED', color: '#94a3b8' },
} as const;
const STATUS = {
  fail: { color: '#fb7185', mark: '✕', order: 0 },
  warn: { color: '#fbbf24', mark: '!', order: 1 },
  unknown: { color: '#94a3b8', mark: '?', order: 2 },
  pass: { color: '#34d399', mark: '✓', order: 3 },
} as const;

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-6)}`;
const nameOf = (t: TokenSafety) => (t.symbol ? `$${t.symbol.replace(/^\$/, '').toUpperCase()}` : short(t.mint));
const fileBase = (t: TokenSafety) => `MarketX_Token_Safety_${(t.symbol || t.mint.slice(0, 8)).replace(/[^A-Za-z0-9]+/g, '')}`;
const sorted = (t: TokenSafety) => [...(t.checks || [])].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order);

/** Short post text (≤ 280): verdict, score, the main risks, the address and the checker */
export function buildTokenSafetyShareText(t: TokenSafety, origin = 'https://marketx.world'): string {
  const v = VERDICT[t.verdict] || VERDICT.UNKNOWN;
  const head = `${nameOf(t)} token safety: ${v.label} (${t.score}/100)`;
  const flagged = sorted(t).filter(c => c.status === 'fail' || c.status === 'warn').map(c => `${c.status === 'fail' ? '✕' : '!'} ${c.label}`);
  const passed = sorted(t).filter(c => c.status === 'pass').slice(0, 3).map(c => `✓ ${c.label}`);
  const tail = [`CA: ${t.mint}`, `Checked on-chain with @_MarketX ${origin.replace(/^https?:\/\//, '')}`, 'Not financial advice'];
  let body = [...flagged, ...passed];
  const text = () => [head, '', ...body, '', ...tail].join('\n');
  while (xLength(text()) > X_POST_LIMIT && body.length) body = body.slice(0, -1);
  return text();
}

const cache = new Map<string, Promise<Blob | null>>();
/** The picture, drawn once per result (ahead of the tap, so the share sheet opens straight away) */
export function prepareTokenSafetyCard(t: TokenSafety): Promise<Blob | null> {
  const key = `${t.mint}|${t.checkedAt}|${t.score}`;
  let job = cache.get(key);
  if (!job) {
    job = renderTokenSafetyCard(t).catch(() => null);
    cache.set(key, job);
    job.then(b => { if (!b) cache.delete(key); });
    if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  }
  return job;
}

export async function renderTokenSafetyCard(t: TokenSafety): Promise<Blob | null> {
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
  const v = VERDICT[t.verdict] || VERDICT.UNKNOWN;

  // Background: dark page, violet and verdict glows, faint dot grid, hairline frame
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, W, H);
  const g1 = ctx.createRadialGradient(W * 0.9, H * 0.06, 10, W * 0.9, H * 0.06, 720);
  g1.addColorStop(0, 'rgba(139,92,246,0.22)');
  g1.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, W, H);
  const g2 = ctx.createRadialGradient(W * 0.12, H * 0.32, 10, W * 0.12, H * 0.32, 560);
  g2.addColorStop(0, `${v.color}22`);
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
  ctx.textBaseline = 'middle';
  // Header: logo, MarketX, "Token safety check" pill
  if (logo) ctx.drawImage(logo, L, 52, 44, 44);
  ctx.font = `700 28px ${SANS}`;
  ctx.fillStyle = '#fafafa';
  ctx.fillText('MarketX', L + 58, 75);
  ctx.font = `600 18px ${SANS}`;
  const pill = 'TOKEN SAFETY CHECK';
  const pw = ctx.measureText(pill).width + 40;
  rr(ctx, R - pw, 54, pw, 42, 21);
  ctx.fillStyle = 'rgba(139,92,246,0.18)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(167,139,250,0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = '#ddd6fe';
  ctx.fillText(pill, R - pw + 20, 76);

  // Token name and address
  ctx.font = `800 76px ${SANS}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(nameOf(t), L, 186);
  ctx.font = `500 22px ${MONO}`;
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(`Solana · ${short(t.mint)}`, L, 246);

  // Score ring + verdict
  const cy = 420;
  const cx = L + 120;
  const r = 104;
  ctx.lineCap = 'round';
  ctx.lineWidth = 20;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = v.color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.max(0, Math.min(100, t.score)) / 100) * Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = `800 72px ${SANS}`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(t.score), cx, cy - 6);
  ctx.font = `600 18px ${SANS}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText('out of 100', cx, cy + 44);
  ctx.textAlign = 'left';

  const tx = cx + r + 56;
  ctx.font = `600 18px ${SANS}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText('VERDICT', tx, cy - 82);
  ctx.font = `800 54px ${SANS}`;
  ctx.fillStyle = v.color;
  ctx.fillText(v.label, tx, cy - 36);
  ctx.font = `500 24px ${SANS}`;
  ctx.fillStyle = '#d4d4d8';
  wrapText(ctx, t.headline, R - tx, 3).forEach((l, i) => ctx.fillText(l, tx, cy + 20 + i * 34));

  // Checks
  const checks = sorted(t);
  const counts = { fail: checks.filter(c => c.status === 'fail').length, warn: checks.filter(c => c.status === 'warn').length, pass: checks.filter(c => c.status === 'pass').length };
  let y = 588;
  ctx.font = `600 18px ${SANS}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText(`ON-CHAIN CHECKS · ${counts.fail} risk${counts.fail === 1 ? '' : 's'} · ${counts.warn} to watch · ${counts.pass} passed`, L, y);
  y += 36;
  const room = H - 200 - y;
  const rowH = 76;
  const shown = checks.slice(0, Math.max(1, Math.floor(room / (rowH + 10))));
  for (const c of shown) {
    const st = STATUS[c.status];
    rr(ctx, L, y, R - L, rowH, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(L + 38, y + rowH / 2, 17, 0, Math.PI * 2);
    ctx.fillStyle = `${st.color}2e`;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.font = `800 18px ${SANS}`;
    ctx.fillStyle = st.color;
    ctx.fillText(st.mark, L + 38, y + rowH / 2 + 1);
    ctx.textAlign = 'left';
    ctx.font = `600 22px ${SANS}`;
    ctx.fillStyle = '#fafafa';
    ctx.fillText(wrapText(ctx, c.label, R - L - 100, 1)[0] || '', L + 74, y + 26);
    ctx.font = `400 17px ${SANS}`;
    ctx.fillStyle = '#a1a1aa';
    ctx.fillText(wrapText(ctx, c.detail || '', R - L - 100, 1)[0] || '', L + 74, y + 52);
    y += rowH + 10;
  }
  if (checks.length > shown.length) {
    ctx.font = `500 17px ${SANS}`;
    ctx.fillStyle = '#71717a';
    ctx.fillText(`+${checks.length - shown.length} more check${checks.length - shown.length === 1 ? '' : 's'} on MarketX`, L, y + 8);
  }

  // Footer: when, the disclaimer, marketx.world
  const fy = H - 76;
  ctx.font = `500 16px ${SANS}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText(`Checked ${new Date(t.checkedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · lowers the risk of a rug pull, can't remove it · not financial advice`, L, fy - 46);
  ctx.font = `700 22px ${SANS}`;
  ctx.fillStyle = '#e4e4e7';
  ctx.fillText('Your Trading Co-Pilot', L, fy);
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

/** Saves the picture (iPhone/iPad: share sheet → Save Image; elsewhere a download) */
export async function saveTokenSafetyCard(t: TokenSafety): Promise<'saved' | 'shared' | 'cancelled' | 'failed'> {
  const blob = await prepareTokenSafetyCard(t);
  if (!blob) return 'failed';
  const name = `${fileBase(t)}.png`;
  const file = new File([blob], name, { type: 'image/png' });
  if (isIOS() && canShareFile(file)) {
    try {
      await navigator.share({ files: [file], title: `${nameOf(t)} token safety` });
      return 'shared';
    } catch (err: any) {
      if (err?.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, name);
  return 'saved';
}

/** Shares the picture with the short text (share sheet); without one, copies the text and saves the picture */
export async function shareTokenSafetyCard(t: TokenSafety): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  const text = buildTokenSafetyShareText(t, typeof window !== 'undefined' ? window.location.origin : undefined);
  const blob = await prepareTokenSafetyCard(t);
  const file = blob ? new File([blob], `${fileBase(t)}.png`, { type: 'image/png' }) : null;
  try {
    if (file && canShareFile(file)) {
      await navigator.share({ files: [file], text, title: `${nameOf(t)} token safety` });
      return 'shared';
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ text, title: `${nameOf(t)} token safety` });
      return 'shared';
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return 'cancelled';
  }
  try {
    await navigator.clipboard?.writeText(text);
  } catch {}
  if (blob) downloadBlob(blob, `${fileBase(t)}.png`);
  return blob ? 'copied' : 'failed';
}

import { UserProfile } from '../types';

export interface GenerateCardOptions {
  userProfile: UserProfile;
  customQuote?: string;
}

// Share card for X: 1200×675 design grid rendered at 2× (2400×1350) so it stays crisp in the X timeline.
const W = 1200;
const H = 675;
const SCALE = 2;

const SANS = '"Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
const MONO = '"Geist Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';

const X_LOGO_PATH =
  'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z';

async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`700 96px ${SANS}`),
      document.fonts.load(`500 28px ${SANS}`),
      document.fonts.load(`500 16px ${MONO}`),
    ]);
    await document.fonts.ready;
  } catch {
    // Fall back to system fonts
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function drawXLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(X_LOGO_PATH));
  ctx.restore();
}

// Pill with optional leading icon; returns its width
function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  opts: { h?: number; font?: string; fg?: string; bg?: string; border?: string; padX?: number; icon?: (cx: number, cy: number) => void; iconW?: number; alignRight?: boolean }
) {
  const h = opts.h ?? 40;
  const padX = opts.padX ?? 18;
  ctx.font = opts.font ?? `500 16px ${SANS}`;
  const iconW = opts.icon ? opts.iconW ?? 22 : 0;
  const w = padX * 2 + iconW + ctx.measureText(text).width;
  const px = opts.alignRight ? x - w : x;
  roundRect(ctx, px, y, w, h, h / 2);
  ctx.fillStyle = opts.bg ?? 'rgba(255,255,255,0.05)';
  ctx.fill();
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (opts.icon) opts.icon(px + padX, y + h / 2);
  ctx.fillStyle = opts.fg ?? '#e4e4e7';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, px + padX + iconW, y + h / 2 + 1);
  return w;
}

// Stylised rising price chart (decorative) on the right side of the card
function drawChart(ctx: CanvasRenderingContext2D) {
  const x0 = 700;
  const x1 = 1140;
  const yTop = 150;
  const yBot = 500;
  // Deterministic smooth-ish uptrend with a pullback into the entry zone
  const pts = [0.62, 0.66, 0.58, 0.6, 0.5, 0.54, 0.44, 0.47, 0.55, 0.5, 0.4, 0.33, 0.37, 0.28, 0.22, 0.26, 0.16, 0.1].map(
    (v, i, arr) => [x0 + (i / (arr.length - 1)) * (x1 - x0), yTop + v * (yBot - yTop)] as [number, number]
  );

  // Entry and target levels
  const entryY = yTop + 0.5 * (yBot - yTop);
  const targetY = yTop + 0.12 * (yBot - yTop);
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
  ctx.beginPath();
  ctx.moveTo(x0, targetY);
  ctx.lineTo(x1, targetY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(167, 139, 250, 0.45)';
  ctx.beginPath();
  ctx.moveTo(x0, entryY);
  ctx.lineTo(x1, entryY);
  ctx.stroke();
  ctx.restore();

  // Area fill on its own layer, faded toward the bottom and both sides, so it never forms a hard panel
  const layer = document.createElement('canvas');
  layer.width = W * SCALE;
  layer.height = H * SCALE;
  const lc = layer.getContext('2d');
  if (lc) {
    lc.scale(SCALE, SCALE);
    const area = lc.createLinearGradient(0, yTop, 0, yBot + 30);
    area.addColorStop(0, 'rgba(139, 92, 246, 0.28)');
    area.addColorStop(1, 'rgba(139, 92, 246, 0)');
    lc.beginPath();
    lc.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1];
      const [cx, cy] = pts[i];
      lc.quadraticCurveTo(px, py, (px + cx) / 2, (py + cy) / 2);
    }
    lc.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
    lc.lineTo(x1, yBot + 30);
    lc.lineTo(x0, yBot + 30);
    lc.closePath();
    lc.fillStyle = area;
    lc.fill();
    lc.globalCompositeOperation = 'destination-out';
    const edges = lc.createLinearGradient(x0, 0, x1, 0);
    edges.addColorStop(0, 'rgba(0,0,0,1)');
    edges.addColorStop(0.3, 'rgba(0,0,0,0)');
    edges.addColorStop(0.9, 'rgba(0,0,0,0)');
    edges.addColorStop(1, 'rgba(0,0,0,0.85)');
    lc.fillStyle = edges;
    lc.fillRect(x0 - 2, yTop - 40, x1 - x0 + 4, yBot - yTop + 80);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer, 0, 0);
    ctx.restore();
  }

  // Line with glow
  const line = ctx.createLinearGradient(x0, 0, x1, 0);
  line.addColorStop(0, '#8b5cf6');
  line.addColorStop(1, '#38bdf8');
  ctx.save();
  ctx.shadowColor = 'rgba(139, 92, 246, 0.8)';
  ctx.shadowBlur = 24;
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = line;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    ctx.quadraticCurveTo(px, py, (px + cx) / 2, (py + cy) / 2);
  }
  ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.stroke();
  ctx.restore();

  // Live dot at the end
  const [ex, ey] = pts[pts.length - 1];
  glow(ctx, ex, ey, 60, 'rgba(56, 189, 248, 0.35)');
  ctx.beginPath();
  ctx.arc(ex, ey, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#e0f2fe';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex, ey, 16, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Level tags
  pill(ctx, x1, targetY - 44, 'TARGET', { h: 30, padX: 12, font: `600 12px ${MONO}`, fg: '#6ee7b7', bg: 'rgba(16,185,129,0.12)', alignRight: true });
  pill(ctx, x1, entryY + 12, 'ENTRY', { h: 30, padX: 12, font: `600 12px ${MONO}`, fg: '#c4b5fd', bg: 'rgba(139,92,246,0.14)', alignRight: true });
}

function renderCard(userProfile: UserProfile, avatar: HTMLImageElement | null, logo: HTMLImageElement | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');
  ctx.scale(SCALE, SCALE);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Background
  ctx.fillStyle = '#08080b';
  ctx.fillRect(0, 0, W, H);
  glow(ctx, 980, 120, 520, 'rgba(124, 58, 237, 0.30)');
  glow(ctx, 1150, 600, 420, 'rgba(14, 165, 233, 0.18)');
  glow(ctx, 120, 700, 420, 'rgba(124, 58, 237, 0.10)');

  // Fine dot grid on the chart side
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let gx = 700; gx < W - 30; gx += 28) {
    for (let gy = 40; gy < H - 40; gy += 28) {
      ctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }

  drawChart(ctx);

  // Card frame
  roundRect(ctx, 16, 16, W - 32, H - 32, 32);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const L = 72;

  // Brand: official MarketX logo + wordmark
  if (logo) {
    ctx.drawImage(logo, L - 2, 60, 56, 56);
  } else {
    roundRect(ctx, L, 64, 48, 48, 24);
    const tile = ctx.createLinearGradient(L, 64, L + 48, 112);
    tile.addColorStop(0, '#8b5cf6');
    tile.addColorStop(1, '#38bdf8');
    ctx.fillStyle = tile;
    ctx.fill();
  }
  ctx.font = `700 30px ${SANS}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fafafa';
  ctx.fillText('Market', L + 64, 89);
  const mw = ctx.measureText('Market').width;
  const xg = ctx.createLinearGradient(L + 64 + mw, 0, L + 64 + mw + 22, 0);
  xg.addColorStop(0, '#a78bfa');
  xg.addColorStop(1, '#38bdf8');
  ctx.fillStyle = xg;
  ctx.fillText('X', L + 64 + mw + 1, 89);

  // Handle chip (top right)
  pill(ctx, W - 72, 68, '@_MarketXai', {
    h: 42,
    font: `500 17px ${SANS}`,
    fg: '#f4f4f5',
    bg: 'rgba(255,255,255,0.06)',
    border: 'rgba(255,255,255,0.10)',
    alignRight: true,
    iconW: 26,
    icon: (cx, cy) => drawXLogo(ctx, cx, cy - 8, 16, '#ffffff'),
  });

  // Headline
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#a1a1aa';
  ctx.font = `500 40px ${SANS}`;
  ctx.fillText('I trade with', L, 262);

  // Auto-fit the headline to its column (fallback fonts can be wider than Geist)
  let headSize = 104;
  ctx.font = `800 ${headSize}px ${SANS}`;
  while (ctx.measureText('MarketX AI').width > 560 && headSize > 60) {
    headSize -= 2;
    ctx.font = `800 ${headSize}px ${SANS}`;
  }
  const hg = ctx.createLinearGradient(L, 0, L + 540, 0);
  hg.addColorStop(0, '#ffffff');
  hg.addColorStop(0.55, '#c4b5fd');
  hg.addColorStop(1, '#7dd3fc');
  ctx.fillStyle = hg;
  ctx.fillText('MarketX AI', L - 4, 368);

  // Feature chips
  let cx = L;
  for (const label of ['Live prices', 'Entries', 'Stops', 'Targets']) {
    cx += pill(ctx, cx, 404, label, { h: 38, padX: 16, font: `500 16px ${SANS}`, fg: '#d4d4d8', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.08)' }) + 10;
  }

  // Trader identity
  const idY = 520;
  const avR = 32;
  const avX = L + avR;
  const avY = idY + avR;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avX, avY, avR, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    const s = Math.min(avatar.width, avatar.height);
    ctx.drawImage(avatar, (avatar.width - s) / 2, (avatar.height - s) / 2, s, s, avX - avR, avY - avR, avR * 2, avR * 2);
  } else {
    const ag = ctx.createLinearGradient(avX - avR, avY - avR, avX + avR, avY + avR);
    ag.addColorStop(0, '#8b5cf6');
    ag.addColorStop(1, '#38bdf8');
    ctx.fillStyle = ag;
    ctx.fillRect(avX - avR, avY - avR, avR * 2, avR * 2);
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 26px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((userProfile.username || 'T').charAt(0).toUpperCase(), avX, avY + 1);
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(avX, avY, avR + 3, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 2;
  ctx.stroke();

  const nameX = avX + avR + 18;
  const displayName = (userProfile.displayName || userProfile.username || 'MarketX Trader').slice(0, 28);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 24px ${SANS}`;
  ctx.fillStyle = '#fafafa';
  ctx.fillText(displayName, nameX, avY - 4);
  const nameW = ctx.measureText(displayName).width;

  if (userProfile.isVerified) {
    const bx = nameX + nameW + 16;
    const by = avY - 12;
    ctx.beginPath();
    ctx.arc(bx, by, 11, 0, Math.PI * 2);
    const vb = ctx.createLinearGradient(bx - 11, by - 11, bx + 11, by + 11);
    vb.addColorStop(0, '#8b5cf6');
    vb.addColorStop(1, '#38bdf8');
    ctx.fillStyle = vb;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx - 5, by);
    ctx.lineTo(bx - 1, by + 4);
    ctx.lineTo(bx + 5.5, by - 4);
    ctx.stroke();
  }

  ctx.font = `500 18px ${MONO}`;
  ctx.fillStyle = '#a1a1aa';
  ctx.fillText(`@${userProfile.username || 'trader'}`, nameX, avY + 24);

  // Website CTA (bottom right)
  pill(ctx, W - 72, idY + 12, 'marketx.world  →', {
    h: 44,
    padX: 20,
    font: `600 17px ${SANS}`,
    fg: '#09090b',
    bg: '#fafafa',
    alignRight: true,
  });

  return canvas;
}

/**
 * Draws the "I trade with MarketX AI" share card (2400×1350 PNG) personalised with the trader's name,
 * handle, avatar and verified badge. Returns a PNG data URL.
 */
export async function generateProfileShareCard(userProfile: UserProfile): Promise<string> {
  await ensureFonts();
  const [avatar, logo] = await Promise.all([
    userProfile.avatarUrl ? loadImage(userProfile.avatarUrl) : Promise.resolve(null),
    loadImage('/brand/marketx-logo-256.png'),
  ]);
  try {
    return renderCard(userProfile, avatar, logo).toDataURL('image/png');
  } catch {
    // A cross-origin avatar without CORS taints the canvas; fall back to the initial
    return renderCard(userProfile, null, logo).toDataURL('image/png');
  }
}

/**
 * Downloads the generated card to the user's device
 */
export function downloadCardImage(dataUrl: string, username: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `MarketX_Card_@${username || 'trader'}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

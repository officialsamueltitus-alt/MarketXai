import { StrategyResult } from '../types';
import { formatMarketPrice } from './formatPrice';

export function shareToX(strategy: StrategyResult, username?: string) {
  const isNoSignal = strategy.tradeType === 'NO_SIGNAL';
  const isLong = strategy.tradeType === 'LONG';
  const actionEmoji = isNoSignal ? '⚪ NO SIGNAL OPPORTUNITY' : isLong ? '🟢 BUY / LONG' : '🔴 SELL / SHORT';
  const formatPrice = (p: number) => formatMarketPrice(p, strategy.currentPrice);

  const cleanHandle = username ? username.replace(/^@/, '') : 'marketx_trader';

  const text = `📊 $${strategy.symbol.replace('/', '')} (${strategy.timeframe} TF)
${actionEmoji} Setup via MarketX (@_MarketX)
👤 Trader: @${cleanHandle}

🎯 Entry Zone: $${formatPrice(strategy.entryZone.optimal)} ($${formatPrice(strategy.entryZone.min)} - $${formatPrice(strategy.entryZone.max)})
🛑 Invalidation Stop: $${formatPrice(strategy.stopLoss.price)} (-${strategy.stopLoss.riskPercent}%)
💰 Primary Target (TP1): $${formatPrice(strategy.takeProfits[0]?.price || 0)} (${strategy.takeProfits[0]?.rewardRatio || ''})
⚖️ Risk / Reward: ${strategy.riskRewardRatio}

🔗 Trade with MarketX SI (@_MarketX): https://marketx.world

#MarketX #Trading #${strategy.symbol.split('/')[0]} #Crypto #Alpha`;

  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  
  // Open tweet intent safely without window.alert
  try {
    const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
    if (!newWindow && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  } catch {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }
}

// Helper to draw a rounded rectangle on HTML5 canvas
function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function fmtPrice(p: number, ref: number): string {
  if (!Number.isFinite(p)) return '-';
  const digits = ref >= 1000 ? 2 : ref >= 10 ? 2 : ref >= 1 ? 4 : 5;
  return p.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(from: number, to: number): string {
  if (!from) return '';
  const v = ((to - from) / from) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

// Sleek 16:9 signal card (2400x1350): pair, direction, confidence, R:R and a price ladder of the key levels
export async function downloadStrategyImage(
  strategy: StrategyResult,
  username?: string,
  isVerified?: boolean
): Promise<boolean> {
  const W = 1200;
  const H = 675;
  const S = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  ctx.scale(S, S);

  try {
    await Promise.all([
      document.fonts?.load('700 40px "Geist"'),
      document.fonts?.load('500 20px "Geist Mono"'),
    ]);
  } catch {}
  const logo = await loadImage('/brand/marketx-logo-256.png');

  const SANS = '"Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
  const MONO = '"Geist Mono", ui-monospace, "SF Mono", Menlo, monospace';
  const isNoSignal = strategy.tradeType === 'NO_SIGNAL';
  const isLong = strategy.tradeType === 'LONG';
  const accent = isNoSignal ? '#a1a1aa' : isLong ? '#34d399' : '#fb7185';
  const accentRgb = isNoSignal ? '161,161,170' : isLong ? '52,211,153' : '251,113,133';
  const ref = strategy.entryZone?.optimal || strategy.currentPrice || 1;

  // Background
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.82, H * 0.18, 10, W * 0.82, H * 0.18, 620);
  glow.addColorStop(0, `rgba(${accentRgb},0.16)`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(W * 0.05, H * 1.0, 10, W * 0.05, H * 1.0, 520);
  glow2.addColorStop(0, 'rgba(139,92,246,0.14)');
  glow2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);
  // Dotted grid
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let x = 24; x < W; x += 28) for (let y = 24; y < H; y += 28) ctx.fillRect(x, y, 1.2, 1.2);
  // Frame
  drawRoundedRect(ctx, 14, 14, W - 28, H - 28, 28);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const L = 64;

  // Header: brand + timeframe/date
  if (logo) ctx.drawImage(logo, L, 52, 36, 36);
  ctx.textBaseline = 'middle';
  ctx.font = `700 24px ${SANS}`;
  ctx.fillStyle = '#fafafa';
  ctx.fillText('Market', L + 48, 71);
  const mw = ctx.measureText('Market').width;
  ctx.fillStyle = '#a78bfa';
  ctx.fillText('X', L + 48 + mw, 71);

  const dateStr = new Date(strategy.timestamp || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.font = `500 15px ${MONO}`;
  const chip = (text: string, right: number, color = '#d4d4d8', bg = 'rgba(255,255,255,0.06)') => {
    const w = ctx.measureText(text).width + 28;
    drawRoundedRect(ctx, right - w, 54, w, 34, 17);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, right - w + 14, 71);
    return right - w - 10;
  };
  let cx = chip(dateStr, W - L, '#a1a1aa');
  chip(`${strategy.timeframe} TF`, cx);

  // Left: pair, direction, stats
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 17px ${SANS}`;
  ctx.fillStyle = '#71717a';
  ctx.fillText((strategy.name || '').slice(0, 42), L, 180);

  let symSize = 92;
  ctx.font = `700 ${symSize}px ${SANS}`;
  while (ctx.measureText(strategy.symbol).width > 560 && symSize > 48) {
    symSize -= 4;
    ctx.font = `700 ${symSize}px ${SANS}`;
  }
  ctx.fillStyle = '#fafafa';
  ctx.fillText(strategy.symbol, L - 3, 180 + symSize * 0.98);

  // Direction pill
  const dirText = isNoSignal ? 'NO TRADE' : isLong ? 'LONG  ▲' : 'SHORT  ▼';
  ctx.font = `700 26px ${SANS}`;
  const pillW = ctx.measureText(dirText).width + 48;
  const pillY = 300;
  drawRoundedRect(ctx, L, pillY, pillW, 58, 29);
  ctx.fillStyle = `rgba(${accentRgb},0.14)`;
  ctx.fill();
  ctx.strokeStyle = `rgba(${accentRgb},0.45)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textBaseline = 'middle';
  ctx.fillText(dirText, L + 24, pillY + 30);

  // Stats: confidence + R:R
  const statY = 410;
  const stat = (x: number, label: string, value: string) => {
    ctx.textBaseline = 'alphabetic';
    ctx.font = `600 13px ${SANS}`;
    ctx.fillStyle = '#71717a';
    ctx.fillText(label.toUpperCase(), x, statY);
    ctx.font = `600 38px ${MONO}`;
    ctx.fillStyle = '#fafafa';
    ctx.fillText(value, x, statY + 46);
  };
  const conf = Math.max(0, Math.min(100, Math.round(strategy.confidenceScore || 0)));
  stat(L, 'Confidence', `${conf}%`);
  const rr = String(strategy.riskRewardRatio || '').replace(/\s+/g, '');
  const rrShort = rr.split(':').length > 2 ? `1:${rr.split(':').pop()}` : rr || '-';
  stat(L + 230, 'Risk : Reward', isNoSignal ? '-' : rrShort);
  // Confidence bar
  drawRoundedRect(ctx, L, statY + 70, 190, 6, 3);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();
  drawRoundedRect(ctx, L, statY + 70, Math.max(6, 1.9 * conf), 6, 3);
  const barGrad = ctx.createLinearGradient(L, 0, L + 190, 0);
  barGrad.addColorStop(0, '#a78bfa');
  barGrad.addColorStop(1, accent);
  ctx.fillStyle = barGrad;
  ctx.fill();

  // Right: price ladder
  const PX = 700;
  const PW = W - L - PX;
  const PY = 140;
  const PH = 400;
  drawRoundedRect(ctx, PX, PY, PW, PH, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.stroke();

  type Lvl = { label: string; price: number; color: string; note: string; main?: boolean };
  const levels: Lvl[] = [];
  if (isNoSignal) {
    levels.push({ label: 'PRICE', price: strategy.currentPrice, color: '#d4d4d8', note: 'Wait for a clean setup', main: true });
  } else {
    (strategy.takeProfits || []).slice(0, 3).forEach((tp, i) =>
      levels.push({ label: `TP${i + 1}`, price: tp.price, color: '#34d399', note: pct(ref, tp.price) })
    );
    levels.push({ label: 'ENTRY', price: strategy.entryZone.optimal, color: '#fafafa', note: 'Optimal entry', main: true });
    levels.push({ label: 'STOP', price: strategy.stopLoss.price, color: '#fb7185', note: pct(ref, strategy.stopLoss.price) });
  }
  levels.sort((a, b) => b.price - a.price);

  const n = levels.length;
  const top = PY + 56;
  const bottom = PY + PH - 56;
  const step = n > 1 ? (bottom - top) / (n - 1) : 0;
  const lineX = PX + 44;
  const ys = levels.map((_, i) => (n > 1 ? top + i * step : (top + bottom) / 2));

  if (n > 1) {
    // Rail: green on the profit side of entry, red on the risk side
    const ei = levels.findIndex(l => l.label === 'ENTRY');
    for (let i = 0; i < n - 1; i++) {
      const profitSide = isLong ? i < ei : i >= ei;
      ctx.strokeStyle = profitSide ? 'rgba(52,211,153,0.55)' : 'rgba(251,113,133,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(lineX, ys[i]);
      ctx.lineTo(lineX, ys[i + 1]);
      ctx.stroke();
    }
  }

  levels.forEach((lv, i) => {
    const y = ys[i];
    if (lv.main) {
      ctx.beginPath();
      ctx.arc(lineX, y, 13, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(lineX, y, lv.main ? 7 : 6, 0, Math.PI * 2);
    ctx.fillStyle = lv.color;
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.font = `600 13px ${SANS}`;
    ctx.fillStyle = lv.color === '#fafafa' || lv.color === '#d4d4d8' ? '#a1a1aa' : lv.color;
    ctx.fillText(lv.label, lineX + 30, y - 12);
    ctx.font = `500 13px ${SANS}`;
    ctx.fillStyle = '#71717a';
    ctx.fillText(lv.note, lineX + 30, y + 12);

    ctx.textAlign = 'right';
    ctx.font = `${lv.main ? 700 : 600} ${lv.main ? 30 : 26}px ${MONO}`;
    ctx.fillStyle = lv.main ? '#fafafa' : '#e4e4e7';
    ctx.fillText(fmtPrice(lv.price, ref), PX + PW - 32, y);
    ctx.textAlign = 'left';
  });

  // Footer: trader + site
  ctx.textBaseline = 'middle';
  const fy = H - 72;
  const handle = `@${(username || 'marketx_trader').replace(/^@/, '')}`;
  ctx.font = `600 20px ${SANS}`;
  ctx.fillStyle = '#e4e4e7';
  ctx.fillText(handle, L, fy);
  let hx = L + ctx.measureText(handle).width + 10;
  if (isVerified) {
    ctx.beginPath();
    ctx.arc(hx + 10, fy, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#8b5cf6';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(hx + 5.5, fy);
    ctx.lineTo(hx + 8.8, fy + 3.4);
    ctx.lineTo(hx + 14.8, fy - 3.4);
    ctx.stroke();
    hx += 28;
  }
  ctx.font = `500 13px ${SANS}`;
  ctx.fillStyle = '#52525b';
  ctx.fillText('Not financial advice · manage your risk', hx + 10, fy + 1);

  ctx.font = `600 18px ${SANS}`;
  const site = 'marketx.world';
  const sw = ctx.measureText(site).width + 40;
  drawRoundedRect(ctx, W - L - sw, fy - 22, sw, 44, 22);
  ctx.fillStyle = '#fafafa';
  ctx.fill();
  ctx.fillStyle = '#09090b';
  ctx.fillText(site, W - L - sw + 20, fy + 1);

  // Convert to image and trigger download reliably
  return new Promise((resolve) => {
    const fileName = `MarketX_${strategy.symbol.replace('/', '')}_${strategy.timeframe}_Setup.png`;

    const triggerDirectDownload = (href: string) => {
      try {
        const link = document.createElement('a');
        link.download = fileName;
        link.href = href;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          resolve(true);
        }, 300);
      } catch (err) {
        console.warn('Direct link download error:', err);
        try {
          window.open(href, '_blank');
          resolve(true);
        } catch {
          resolve(false);
        }
      }
    };

    if (canvas.toBlob) {
      canvas.toBlob((blob) => {
        if (blob) {
          const blobUrl = URL.createObjectURL(blob);
          triggerDirectDownload(blobUrl);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } else {
          const dataUrl = canvas.toDataURL('image/png');
          triggerDirectDownload(dataUrl);
        }
      }, 'image/png');
    } else {
      const dataUrl = canvas.toDataURL('image/png');
      triggerDirectDownload(dataUrl);
    }
  });
}

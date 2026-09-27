import { StrategyResult } from '../types';

export function shareToX(strategy: StrategyResult, username?: string) {
  const isNoSignal = strategy.tradeType === 'NO_SIGNAL';
  const isLong = strategy.tradeType === 'LONG';
  const actionEmoji = isNoSignal ? '⚪ NO SIGNAL OPPORTUNITY' : isLong ? '🟢 BUY / LONG' : '🔴 SELL / SHORT';
  const formatPrice = (p: number) =>
    strategy.currentPrice < 10 ? p.toFixed(4) : p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const cleanHandle = username ? username.replace(/^@/, '') : 'marketx_trader';

  const text = `📊 $${strategy.symbol.replace('/', '')} (${strategy.timeframe} TF)
${actionEmoji} Setup via MarketX
👤 Trader: @${cleanHandle}

🎯 Entry Zone: $${formatPrice(strategy.entryZone.optimal)} ($${formatPrice(strategy.entryZone.min)} - $${formatPrice(strategy.entryZone.max)})
🛑 Invalidation Stop: $${formatPrice(strategy.stopLoss.price)} (-${strategy.stopLoss.riskPercent}%)
💰 Primary Target (TP1): $${formatPrice(strategy.takeProfits[0]?.price || 0)} (${strategy.takeProfits[0]?.rewardRatio || ''})
⚖️ Risk / Reward: ${strategy.riskRewardRatio}

🔗 Trade with AI: https://marketx.world

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

export async function downloadStrategyImage(
  strategy: StrategyResult,
  username?: string,
  isVerified?: boolean
): Promise<boolean> {
  const canvas = document.createElement('canvas');
  const width = 1200;
  const height = 800;
  const scale = 2; // 2x Retina high-resolution render (2400 x 1600)
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;

  ctx.scale(scale, scale);

  const isLong = strategy.tradeType === 'LONG';
  const formatPrice = (p: number) =>
    strategy.currentPrice < 10 ? p.toFixed(4) : p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const cardX = 16;
  const cardY = 16;
  const cardW = width - 32;
  const cardH = height - 32;
  const cardRadius = 32;

  // 1. Transparent Clear & Curved Image Card Background
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardRadius);
  ctx.clip();

  // Solid Deep Black / Obsidian Gradient Background inside curved card
  const bgGrad = ctx.createLinearGradient(0, cardY, 0, cardY + cardH);
  bgGrad.addColorStop(0, '#0a0d14');
  bgGrad.addColorStop(1, '#020408');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(cardX, cardY, cardW, cardH);

  // Subtle ambient directional glow
  const glowGrad = ctx.createRadialGradient(width * 0.8, height * 0.2, 50, width * 0.8, height * 0.2, 550);
  glowGrad.addColorStop(0, isLong ? 'rgba(16, 185, 129, 0.18)' : 'rgba(244, 63, 94, 0.18)');
  glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glowGrad;
  ctx.fillRect(cardX, cardY, cardW, cardH);

  ctx.restore();

  // Outer curved border with multi-hue metallic gradient sheen
  drawRoundedRect(ctx, cardX, cardY, cardW, cardH, cardRadius);
  const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
  borderGrad.addColorStop(0, 'rgba(56, 189, 248, 0.45)');
  borderGrad.addColorStop(0.35, 'rgba(129, 140, 248, 0.3)');
  borderGrad.addColorStop(0.7, 'rgba(192, 132, 252, 0.35)');
  borderGrad.addColorStop(1, 'rgba(52, 211, 153, 0.4)');
  ctx.strokeStyle = borderGrad;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Inner subtle border highlight
  drawRoundedRect(ctx, cardX + 2, cardY + 2, cardW - 4, cardH - 4, cardRadius - 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 2. Top Header: MarketX Branding (Joined together with NO space)
  ctx.font = '800 38px "Geist Mono", monospace, sans-serif';
  const marketText = 'Market';
  const marketWidth = ctx.measureText(marketText).width;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(marketText, 60, 80);

  // "X" in vibrant cyan/indigo joined immediately with Market
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('X', 60 + marketWidth, 80);

  // Website URL Pill next to MarketX
  const webPillX = 60 + marketWidth + 28;
  const webPillY = 56;
  drawRoundedRect(ctx, webPillX, webPillY, 116, 28, 8);
  ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = '700 13px "Geist Mono", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('marketx.world', webPillX + 14, webPillY + 19);

  // Header Subtitle: The Intelligence Layer for Every Market
  ctx.font = '600 13.5px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText('The Intelligence Layer for Every Market', 60, 106);

  const cleanHandle = username ? username.replace(/^@/, '') : 'trader';
  const traderSig = isVerified ? `@${cleanHandle} ✓ (VERIFIED)` : `@${cleanHandle}`;

  // Draw Trader handle badge on the right
  ctx.font = 'bold 15px "Geist Mono", monospace, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = isVerified ? '#38bdf8' : '#e2e8f0';
  ctx.fillText(`Analyst: ${traderSig}`, width - 60, 75);

  const dateStr = new Date().toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' • ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  ctx.font = '500 13px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(dateStr, width - 60, 102);
  ctx.textAlign = 'left';

  // Divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, 128);
  ctx.lineTo(width - 60, 128);
  ctx.stroke();

  // 3. Asset & Trade Type Headline
  ctx.font = '800 46px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(strategy.symbol, 60, 190);

  const symWidth = ctx.measureText(strategy.symbol).width;

  // Timeframe Badge with curved edges
  drawRoundedRect(ctx, 75 + symWidth, 155, 80, 34, 10);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = 'bold 15px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`${strategy.timeframe} TF`, 86 + symWidth, 178);

  // Asset Name & Live Quote
  ctx.font = '500 16px system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(`${strategy.name} • Live: $${formatPrice(strategy.currentPrice)}`, 60, 222);

  // Action Badge (BUY LIMIT / SELL LIMIT / NO SIGNAL) with curved edges
  const isNoSignal = strategy.tradeType === 'NO_SIGNAL';
  const actionText = isNoSignal ? 'NO SIGNAL OPPORTUNITY' : isLong ? 'BUY LIMIT / LONG' : 'SELL LIMIT / SHORT';
  const badgeColor = isNoSignal ? '#94a3b8' : isLong ? '#10b981' : '#f43f5e';
  const badgeBg = isNoSignal ? 'rgba(148, 163, 184, 0.15)' : isLong ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)';

  drawRoundedRect(ctx, width - 320, 150, 260, 46, 14);
  ctx.fillStyle = badgeBg;
  ctx.fill();
  ctx.strokeStyle = badgeColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.font = 'bold 16px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.fillText(actionText, width - 190, 180);
  ctx.textAlign = 'left';

  // Confluence Score & POI Mitigation
  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#818cf8';
  const untouchedCount = strategy.unmitigatedZonesCount ?? (strategy.poiZones ? strategy.poiZones.filter(z => z.mitigationStatus === 'UNMITIGATED').length : 2);
  const tappedCount = strategy.mitigatedZonesCount ?? (strategy.poiZones ? strategy.poiZones.filter(z => z.mitigationStatus === 'MITIGATED').length : 1);
  ctx.fillText(`⚡ ${strategy.confidenceScore}% Confluence • 🟢 ${untouchedCount} Untouched POI • ⚡ ${tappedCount} Tapped`, width - 420, 220);

  // 4. Four Core Matrix Boxes with curved edges
  const boxY = 255;
  const boxHeight = 160;
  const gap = 20;
  const boxWidth = (width - 120 - gap * 3) / 4;

  const boxes = [
    {
      title: 'OPTIMAL ENTRY',
      val: `$${formatPrice(strategy.entryZone.optimal)}`,
      sub: `$${strategy.entryZone.min} - $${strategy.entryZone.max}`,
      border: 'rgba(245, 158, 11, 0.4)',
      bg: 'rgba(245, 158, 11, 0.08)',
      valColor: '#fbbf24',
    },
    {
      title: 'STOP LOSS (INVALIDATION)',
      val: `$${formatPrice(strategy.stopLoss.price)}`,
      sub: `Risk: -${strategy.stopLoss.riskPercent}%`,
      border: 'rgba(244, 63, 94, 0.4)',
      bg: 'rgba(244, 63, 94, 0.08)',
      valColor: '#f43f5e',
    },
    {
      title: 'PRIMARY TARGET (TP1)',
      val: `$${formatPrice(strategy.takeProfits[0]?.price || 0)}`,
      sub: `${strategy.takeProfits[0]?.rewardRatio || ''} (${strategy.takeProfits[0]?.exitPercent || 50}% Scale)`,
      border: 'rgba(16, 185, 129, 0.4)',
      bg: 'rgba(16, 185, 129, 0.08)',
      valColor: '#34d399',
    },
    {
      title: 'RISK / REWARD RATIO',
      val: strategy.riskRewardRatio,
      sub: 'Optimal Expectancy Profile',
      border: 'rgba(99, 102, 241, 0.4)',
      bg: 'rgba(99, 102, 241, 0.08)',
      valColor: '#a5b4fc',
    },
  ];

  boxes.forEach((box, i) => {
    const x = 60 + i * (boxWidth + gap);
    // Box background with curved edges
    drawRoundedRect(ctx, x, boxY, boxWidth, boxHeight, 16);
    ctx.fillStyle = box.bg;
    ctx.fill();
    ctx.strokeStyle = box.border;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Title
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(box.title, x + 16, boxY + 34);

    // Main Value
    ctx.font = 'bold 24px "Geist Mono", monospace, sans-serif';
    ctx.fillStyle = box.valColor;
    ctx.fillText(box.val, x + 16, boxY + 84);

    // Subtitle
    ctx.font = '500 13px "Geist Mono", monospace, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(box.sub, x + 16, boxY + 124);
  });

  // 5. Extended Take Profits Strip with curved edges
  if (strategy.takeProfits.length > 1) {
    const tpY = 445;
    drawRoundedRect(ctx, 60, tpY, width - 120, 50, 14);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('ADDITIONAL PROFIT TARGETS:', 80, tpY + 30);

    // Explicitly separate TP2 and TP3 with dedicated wide space between them
    const additionalTargets = strategy.takeProfits.slice(1);
    const boxWidth = 230;
    const spaceBetweenTp = 55; // Generous space separating TP2 from TP3
    const startX = 330;

    additionalTargets.forEach((tp, idx) => {
      const currX = startX + idx * (boxWidth + spaceBetweenTp);
      const tpStr = `${tp.level}: $${formatPrice(tp.price)} (${tp.rewardRatio})`;
      drawRoundedRect(ctx, currX, tpY + 10, boxWidth, 30, 8);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = 'bold 12px "Geist Mono", monospace, sans-serif';
      ctx.fillStyle = '#6ee7b7';
      ctx.fillText(tpStr, currX + 14, tpY + 30);
    });
  }

  // 6. Rationale / Confluence Box with curved edges
  const ratY = strategy.takeProfits.length > 1 ? 520 : 455;
  const ratHeight = 175;
  drawRoundedRect(ctx, 60, ratY, width - 120, ratHeight, 18);
  ctx.fillStyle = 'rgba(14, 165, 233, 0.04)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = 'bold 13px system-ui, sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('INSTITUTIONAL THESIS & 0.618 GOLDEN POCKET CONFLUENCE', 80, ratY + 34);

  ctx.font = '400 15px system-ui, sans-serif';
  ctx.fillStyle = '#e2e8f0';

  const textToWrap = strategy.entryZone.rationale ||
    'High confluence alignment detected at the 0.618 Fibonacci retracement zone. Institutional bid density absorbs retail selling with defined invalidation below swing low.';
  
  // Wrap text
  const words = textToWrap.split(' ');
  let line = '';
  let yPos = ratY + 68;
  const maxWidth = width - 160;

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, 80, yPos);
      line = words[n] + ' ';
      yPos += 24;
      if (yPos > ratY + ratHeight - 20) break;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, 80, yPos);

  // 7. Footer with prominent website URL
  const footY = height - 40;
  ctx.font = '700 13.5px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('marketx.world', 60, footY);

  ctx.font = '500 12.5px "Geist Mono", monospace, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('  •  The Intelligence Layer for Every Market  •  Algorithmic Institutional Intelligence', 152, footY);

  ctx.textAlign = 'right';
  ctx.fillText(`ID: ${(strategy.symbol.replace('/', '') + '_' + strategy.timeframe + '_' + Date.now().toString(36)).toUpperCase()}`, width - 60, footY);
  ctx.textAlign = 'left';

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

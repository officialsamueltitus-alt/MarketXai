import { UserProfile } from '../types';

export interface GenerateCardOptions {
  userProfile: UserProfile;
  customQuote?: string;
}

/**
 * Procedurally draws a sleek, minimalist, Ultra-HD 16:9 social share card for X (Twitter):
 * - Generated at 2400 × 1350 Ultra-HD high quality resolution
 * - Clean obsidian dark luxury background with subtle atmospheric glow
 * - Official MarketX logo & branding
 * - Sleek tagline under logo: "The Intelligence Layer for Every Market"
 * - Main bold headline: "I Trade with MarketX Ai"
 * - User's verified username & avatar pill
 * - Official Twitter handle: @_MarketXai
 * - Official website link: marketx.ai
 */
export async function generateProfileShareCard(
  userProfile: UserProfile
): Promise<string> {
  // Ensure web fonts are loaded and ready before canvas rasterization
  if (typeof document !== 'undefined' && document.fonts) {
    try {
      await document.fonts.ready;
    } catch {
      // Gracefully continue
    }
  }

  // Ultra-HD 2x supersampled canvas resolution: 2400 × 1350 px
  const scale = 2;
  const baseWidth = 1200;
  const baseHeight = 675;

  const canvas = document.createElement('canvas');
  canvas.width = baseWidth * scale; // 2400 px
  canvas.height = baseHeight * scale; // 1350 px
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get canvas context');

  // Configure high-quality rendering
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(scale, scale);

  const width = baseWidth;
  const height = baseHeight;

  // 1. Deep Obsidian Slate Canvas
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, '#0a0d16');
  bgGrad.addColorStop(0.5, '#06080e');
  bgGrad.addColorStop(1, '#040509');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Soft atmospheric radial glow behind the center content
  const centerGlow = ctx.createRadialGradient(600, 310, 30, 600, 310, 480);
  centerGlow.addColorStop(0, 'rgba(99, 102, 241, 0.16)');
  centerGlow.addColorStop(0.5, 'rgba(6, 182, 212, 0.08)');
  centerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = centerGlow;
  ctx.fillRect(0, 0, width, height);

  // Subtle top-right and bottom-left atmospheric accents
  const trGlow = ctx.createRadialGradient(width - 120, 80, 20, width - 120, 80, 320);
  trGlow.addColorStop(0, 'rgba(168, 85, 247, 0.12)');
  trGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = trGlow;
  ctx.fillRect(0, 0, width, height);

  const blGlow = ctx.createRadialGradient(140, height - 80, 20, 140, height - 80, 300);
  blGlow.addColorStop(0, 'rgba(6, 182, 212, 0.1)');
  blGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = blGlow;
  ctx.fillRect(0, 0, width, height);

  // 2. Sleek Outer Card Frame
  const frameInset = 36;
  const frameW = width - frameInset * 2;
  const frameH = height - frameInset * 2;
  const frameR = 24;

  ctx.save();
  ctx.beginPath();
  roundRect(ctx, frameInset, frameInset, frameW, frameH, frameR);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Subtle corner crosshairs for clean precision
  const corners = [
    { x: frameInset, y: frameInset },
    { x: width - frameInset, y: frameInset },
    { x: frameInset, y: height - frameInset },
    { x: width - frameInset, y: height - frameInset },
  ];
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
  ctx.lineWidth = 1.5;
  corners.forEach((c) => {
    ctx.beginPath();
    ctx.moveTo(c.x - 10, c.y);
    ctx.lineTo(c.x + 10, c.y);
    ctx.moveTo(c.x, c.y - 10);
    ctx.lineTo(c.x, c.y + 10);
    ctx.stroke();
  });
  ctx.restore();

  // 3. MARKETX LOGO & TAGLINE (Top Center)
  ctx.save();
  const logoCenterY = 96;
  const iconSize = 44;
  const iconX = 600 - 130;
  const iconY = logoCenterY - iconSize / 2;

  // Modern Logo Icon Box
  ctx.beginPath();
  roundRect(ctx, iconX, iconY, iconSize, iconSize, 12);
  const iconBg = ctx.createLinearGradient(iconX, iconY, iconX + iconSize, iconY + iconSize);
  iconBg.addColorStop(0, '#161b2e');
  iconBg.addColorStop(1, '#0b0e18');
  ctx.fillStyle = iconBg;
  ctx.fill();

  ctx.lineWidth = 1.5;
  const iconBorder = ctx.createLinearGradient(iconX, iconY, iconX + iconSize, iconY + iconSize);
  iconBorder.addColorStop(0, '#6366f1');
  iconBorder.addColorStop(1, '#06b6d4');
  ctx.strokeStyle = iconBorder;
  ctx.stroke();

  // Stylized X inside logo icon
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(iconX + 13, iconY + 13);
  ctx.lineTo(iconX + iconSize - 13, iconY + iconSize - 13);
  ctx.stroke();

  ctx.strokeStyle = '#c084fc';
  ctx.beginPath();
  ctx.moveTo(iconX + iconSize - 13, iconY + 13);
  ctx.lineTo(iconX + 13, iconY + iconSize - 13);
  ctx.stroke();

  // "MarketX" text beside the icon
  const textStartX = iconX + iconSize + 14;
  ctx.textAlign = 'left';
  ctx.font = '800 32px "Geist", system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Market', textStartX, logoCenterY + 10);

  const marketWidth = ctx.measureText('Market').width;
  const xGrad = ctx.createLinearGradient(
    textStartX + marketWidth,
    logoCenterY - 16,
    textStartX + marketWidth + 24,
    logoCenterY + 10
  );
  xGrad.addColorStop(0, '#f43f5e');
  xGrad.addColorStop(0.5, '#a855f7');
  xGrad.addColorStop(1, '#06b6d4');
  ctx.fillStyle = xGrad;
  ctx.fillText('X', textStartX + marketWidth + 2, logoCenterY + 10);

  // Sleek Tagline Under the Logo: "The Intelligence Layer for Every Market"
  ctx.textAlign = 'center';
  ctx.font = '600 13px "Geist Mono", monospace';
  ctx.letterSpacing = '1.8px';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
  ctx.fillText('The Intelligence Layer for Every Market', 600, logoCenterY + 46);

  // Subtle decorative rules flanking the tagline
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(270, logoCenterY + 41);
  ctx.lineTo(370, logoCenterY + 41);
  ctx.moveTo(830, logoCenterY + 41);
  ctx.lineTo(930, logoCenterY + 41);
  ctx.stroke();

  ctx.restore();

  // 4. MAIN HERO TYPOGRAPHY: "I Trade with MarketX Ai" (Centered)
  ctx.save();
  ctx.textAlign = 'center';

  // Line 1: "I Trade with"
  ctx.font = '600 40px "Geist", system-ui, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.letterSpacing = '0.5px';
  ctx.fillText('I Trade with', 600, 240);

  // Line 2: "MarketX Ai" (Luminous glow & gradient)
  const line2Y = 330;

  // Ambient neon glow pass
  ctx.shadowColor = 'rgba(99, 102, 241, 0.4)';
  ctx.shadowBlur = 32;
  ctx.font = '900 82px "Geist", system-ui, sans-serif';

  const titleGrad = ctx.createLinearGradient(350, line2Y - 70, 850, line2Y);
  titleGrad.addColorStop(0, '#ffffff');
  titleGrad.addColorStop(0.35, '#a5b4fc');
  titleGrad.addColorStop(0.7, '#c084fc');
  titleGrad.addColorStop(1, '#38bdf8');
  ctx.fillStyle = titleGrad;
  ctx.fillText('MarketX Ai', 600, line2Y);

  // Sharp crisp overlay
  ctx.shadowBlur = 0;
  ctx.fillText('MarketX Ai', 600, line2Y);
  ctx.restore();

  // 5. USER'S USERNAME PILL (Centered)
  ctx.save();
  const usernameStr = `@${userProfile.username || 'trader'}`;
  const pillW = 380;
  const pillH = 72;
  const pillX = 600 - pillW / 2;
  const pillY = 398;

  // Frosted dark pill background
  ctx.beginPath();
  roundRect(ctx, pillX, pillY, pillW, pillH, 36);
  const pillBg = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY + pillH);
  pillBg.addColorStop(0, 'rgba(17, 24, 39, 0.85)');
  pillBg.addColorStop(1, 'rgba(10, 14, 26, 0.9)');
  ctx.fillStyle = pillBg;
  ctx.fill();

  // Subtle border with gradient highlight
  ctx.lineWidth = 1.5;
  const pillBorder = ctx.createLinearGradient(pillX, pillY, pillX + pillW, pillY + pillH);
  pillBorder.addColorStop(0, 'rgba(99, 102, 241, 0.5)');
  pillBorder.addColorStop(0.5, 'rgba(6, 182, 212, 0.4)');
  pillBorder.addColorStop(1, 'rgba(168, 85, 247, 0.5)');
  ctx.strokeStyle = pillBorder;
  ctx.stroke();

  // User Avatar Circle
  const avRadius = 24;
  const avCenterX = pillX + 36;
  const avCenterY = pillY + pillH / 2;

  ctx.beginPath();
  ctx.arc(avCenterX, avCenterY, avRadius, 0, Math.PI * 2);
  const avGrad = ctx.createLinearGradient(
    avCenterX - avRadius,
    avCenterY - avRadius,
    avCenterX + avRadius,
    avCenterY + avRadius
  );
  avGrad.addColorStop(0, '#6366f1');
  avGrad.addColorStop(1, '#06b6d4');
  ctx.fillStyle = avGrad;
  ctx.fill();

  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.stroke();

  // Avatar Initials
  const initials = (userProfile.username || 'MX').slice(0, 2).toUpperCase();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 18px "Geist", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, avCenterX, avCenterY);

  // Username Text
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '800 24px "Geist", system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(usernameStr, avCenterX + avRadius + 14, pillY + 38);

  // Verified Pro Badge Check
  const usernameWidth = ctx.measureText(usernameStr).width;
  const checkX = avCenterX + avRadius + 14 + usernameWidth + 10;
  const checkY = pillY + 30;

  ctx.beginPath();
  ctx.arc(checkX, checkY, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#06b6d4';
  ctx.fill();

  ctx.fillStyle = '#0a0d18';
  ctx.font = '900 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('✓', checkX, checkY);

  // Sub-badge: "VERIFIED TRADER"
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '700 10.5px "Geist Mono", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.letterSpacing = '1px';
  ctx.fillText('VERIFIED TRADER', avCenterX + avRadius + 14, pillY + 56);

  ctx.restore();

  // 6. FOOTER: TWITTER HANDLE & WEBSITE LINK
  ctx.save();
  const sepY = 528;

  // Thin minimalist divider line
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(340, sepY);
  ctx.lineTo(860, sepY);
  ctx.stroke();

  // Sleek Footer Badges / Chips
  const chipY = 558;
  const chipH = 42;

  // Left Chip: Twitter Handle (𝕏 @_MarketXai)
  const twW = 210;
  const twX = 600 - twW - 14;

  ctx.beginPath();
  roundRect(ctx, twX, chipY, twW, chipH, 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 15px "Geist Mono", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('𝕏  @_MarketXai', twX + twW / 2, chipY + chipH / 2);

  // Right Chip: Website Link (marketx.world)
  const webW = 210;
  const webX = 600 + 14;

  ctx.beginPath();
  roundRect(ctx, webX, chipY, webW, chipH, 12);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 15px "Geist Mono", monospace';
  ctx.fillStyle = '#38bdf8';
  ctx.fillText('marketx.world', webX + webW / 2, chipY + chipH / 2);

  ctx.restore();

  return canvas.toDataURL('image/png');
}

/**
 * Helper to download the generated image directly to the user's filesystem
 */
export function downloadCardImage(dataUrl: string, username: string) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = `MarketX_UltraHD_Card_@${username || 'trader'}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Helper to draw rounded rectangles on canvas
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Halloween ads on the owner's two reference images (a poster 800x1200 and a web hero 1200x800). The reference artwork is
// kept; its text and logos are cleaned off the picture and MarketX's are set in their place, accents in the site's violet.
// Usage: node brand/posts/make-halloween.cjs POSTER.jpg HERO.jpg OUT_DIR
// The poster title's yellow is recoloured to the site's violet → fuchsia, keeping its shading.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const [POSTER, HERO, OUT] = process.argv.slice(2).map(p => path.resolve(p));
const ROOT = path.join(__dirname, '..', '..');
const b64 = f => 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(f).toString('base64');
const LOGO = b64(path.join(ROOT, 'public/brand/marketx-logo-256.png'));
const SOCIAL = ['x', 'telegram', 'youtube'].map(n => b64(path.join(ROOT, `public/brand/social/${n}-72.png`)));
const CODE = 'HallowX';

// Canvas helpers run in the page: fill(x0..x1, y0..y1) blends each column between the pixels just above and below the box
const CANVAS_JS = `
function clean(ctx, W, H, boxes, after) {
  const d = ctx.getImageData(0, 0, W, H), p = d.data;
  const at = (X, Y) => { const i = (Y * W + X) * 4; return [p[i], p[i + 1], p[i + 2]]; };
  const put = (X, Y, c) => { const i = (Y * W + X) * 4; p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; };
  // Coons patch: each box is rebuilt from all four of its edges, so it meets the picture around it without a seam
  for (const [x0, y0, x1, y1] of boxes) {
    const T = [], B = [], L = [], R = [];
    for (let X = x0; X <= x1; X++) { T.push(at(X, y0)); B.push(at(X, y1)); }
    for (let Y = y0; Y <= y1; Y++) { L.push(at(x0, Y)); R.push(at(x1, Y)); }
    for (let Y = y0 + 1; Y < y1; Y++) for (let X = x0 + 1; X < x1; X++) {
      const s = (X - x0) / (x1 - x0), t = (Y - y0) / (y1 - y0), i = X - x0, j = Y - y0;
      put(X, Y, [0, 1, 2].map(k => Math.round(
        (1 - t) * T[i][k] + t * B[i][k] + (1 - s) * L[j][k] + s * R[j][k]
        - ((1 - s) * (1 - t) * T[0][k] + s * (1 - t) * T[T.length - 1][k] + (1 - s) * t * B[0][k] + s * t * B[B.length - 1][k]))));
    }
  }
  // a light blur inside each box hides the grain change
  for (const [x0, y0, x1, y1] of boxes) for (let pass = 0; pass < 2; pass++) for (let Y = y0 + 2; Y < y1 - 1; Y++) for (let X = x0 + 2; X < x1 - 1; X++) {
    const n = [at(X - 2, Y), at(X + 2, Y), at(X, Y - 2), at(X, Y + 2)], c = at(X, Y);
    put(X, Y, c.map((v, k) => Math.round((v * 2 + n[0][k] + n[1][k] + n[2][k] + n[3][k]) / 6)));
  }
  if (after) after(at, put);
  ctx.putImageData(d, 0, 0);
}`;

const poster = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:800px;height:1200px;overflow:hidden;background:#000}
body{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#fff}.a{position:absolute}
.grad{background:linear-gradient(100deg,#c4b5fd,#a78bfa 35%,#e879f9);-webkit-background-clip:text;background-clip:text;color:transparent}
</style></head><body>
<canvas id="c" width="800" height="1200" class="a" style="left:0;top:0"></canvas>
<div class="a" style="left:22px;top:20px;display:flex;align-items:center;gap:9px">
  <img src="${LOGO}" style="width:38px;height:38px">
  <div><p style="font-size:19px;font-weight:800;letter-spacing:-.4px;line-height:1">MarketX</p>
  <p style="margin-top:3px;font-size:7.5px;font-weight:700;letter-spacing:1.6px;color:#c4b5fd">YOUR TRADING CO-PILOT</p></div>
</div>
<p class="a" style="left:0;width:800px;top:266px;text-align:center;font-size:13.5px;font-weight:600;line-height:1.35;letter-spacing:.2px;color:#f4f4f6;text-shadow:0 2px 8px rgba(0,0,0,.6)">
  A Halloween treat on MarketX Pro: the Trading Agent,<br>Fundamental Analysis, the watchlist and more.</p>
<div class="a" style="left:0;width:800px;top:314px;display:flex;justify-content:center">
  <div style="display:flex;align-items:center;gap:12px;padding:8px 10px 8px 18px;border-radius:16px;background:rgba(14,10,30,.72);border:1px solid rgba(196,181,253,.35);box-shadow:0 10px 30px -10px rgba(139,92,246,.7)">
    <span style="font-size:12px;font-weight:700;letter-spacing:2px;color:#c4b5fd">USE CODE</span>
    <span style="padding:6px 14px;border-radius:10px;border:1.5px dashed rgba(255,255,255,.55);background:linear-gradient(100deg,#7c3aed,#c026d3);font-size:22px;font-weight:800;letter-spacing:.5px">${CODE}</span>
  </div>
</div>
<p class="a" style="left:0;width:800px;top:378px;text-align:center;font-size:14px;font-weight:500;color:#e9e9f2;text-shadow:0 2px 6px rgba(0,0,0,.6)">marketx.world</p>
<p class="a" style="left:0;width:800px;top:1139px;text-align:center;font-size:16px;font-weight:700;letter-spacing:.3px">Follow us</p>
<div class="a" style="left:0;width:800px;top:1164px;display:flex;justify-content:center;gap:8px">${SOCIAL.map(s => `<img src="${s}" style="width:26px;height:26px">`).join('')}</div>
<script>${CANVAS_JS}
const img = new Image(); img.onload = () => {
  const c = document.getElementById('c'), x = c.getContext('2d'); x.drawImage(img, 0, 0, 800, 1200);
  clean(x, 800, 1200, [[14, 14, 128, 58], [205, 262, 600, 308], [300, 312, 500, 356], [315, 356, 485, 386], [326, 1128, 474, 1199]], (at, put) => {
    // the title's yellow → violet/fuchsia across its width, same light and shade
    for (let Y = 100; Y < 300; Y++) for (let X = 140; X < 630; X++) {
      const [r, g, b] = at(X, Y), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx < 60 || (mx - mn) / mx < 0.28) continue;
      const hue = r === mx ? 60 * ((g - b) / (mx - mn)) : g === mx ? 60 * (2 + (b - r) / (mx - mn)) : 999;
      if (!(hue > 22 && hue < 72)) continue;
      const L = mx / 255, t = (X - 150) / 475;
      const v = [139 + (217 - 139) * t, 92 + (70 - 92) * t, 246 + (239 - 246) * t];
      put(X, Y, v.map(k => Math.min(255, Math.round(k * (0.35 + L * 0.85)))));
    }
  });
  document.title = 'ready';
}; img.src = '${b64(POSTER)}';
</script></body></html>`;

const card = (title, text) => `<p style="font-size:21px;font-weight:500;letter-spacing:-.3px">${title}</p><p style="margin-top:6px;font-size:13px;color:#e4e4ea">${text}</p>`;
const hero = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1200px;height:800px;overflow:hidden;background:#000}
body{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#fff}.a{position:absolute}
.grad{background:linear-gradient(100deg,#ddd6fe,#c4b5fd 40%,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent}
</style></head><body>
<canvas id="c" width="1200" height="800" class="a" style="left:0;top:0"></canvas>
<div class="a" style="left:60px;top:26px;display:flex;align-items:center;gap:9px"><img src="${LOGO}" style="width:32px;height:32px"><span style="font-size:19px;font-weight:600;letter-spacing:-.2px">MarketX</span></div>
<div class="a" style="left:478px;top:34px;display:flex;gap:44px;font-size:13px;color:#ececf1"><span>Features</span><span>Pro</span><span>Guide</span></div>
<p class="a" style="left:1014px;top:25px;width:126px;height:33px;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px;color:#111">Get Pro <span style="font-size:15px">→</span></p>
<h1 class="a" style="left:62px;top:198px;font-size:76px;font-weight:500;line-height:.98;letter-spacing:-3.4px">Trade the<br><span class="grad">spooky season.</span></h1>
<p class="a" style="left:70px;top:362px;font-size:21px;line-height:1.38;color:#d4d4dc;font-weight:300">Ask SI for a trade plan and let your<br>Trading Agent do the busy work.</p>
<p class="a" style="left:124px;top:468px;font-size:13px;color:#d9d9e0">Use code <b style="color:#fff;font-weight:700">${CODE}</b> for a Halloween deal on Pro</p>
<div class="a" style="left:87px;top:698px;width:300px">${card(`Code <span class="grad" style="font-weight:700">${CODE}</span>`, 'A Halloween deal on MarketX Pro.')}</div>
<div class="a" style="left:453px;top:698px;width:300px">${card('Trading Agent', 'Trades your MT5 while you are out.')}</div>
<div class="a" style="left:817px;top:698px;width:300px">${card('Proof on Solana', 'Every signal sealed, every result public.')}</div>
<svg class="a" style="left:829px;top:653px" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>
<script>${CANVAS_JS}
const img = new Image(); img.onload = () => {
  const c = document.getElementById('c'), x = c.getContext('2d'); x.drawImage(img, 0, 0, 1200, 800);
  clean(x, 1200, 800, [
    [58, 22, 196, 64], [480, 28, 712, 58], [1022, 30, 1132, 54],
    [50, 196, 446, 354], [56, 356, 334, 426], [118, 462, 340, 492],
    [84, 694, 330, 728], [84, 728, 330, 756], [450, 694, 700, 728], [450, 728, 700, 756], [814, 694, 1070, 728], [814, 728, 1070, 756],
    [829, 653, 857, 680],
  ]);
  document.title = 'ready';
}; img.src = '${b64(HERO)}';
</script></body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  for (const [name, html, w, h] of [['marketx-halloween-poster.png', poster, 800, 1200], ['marketx-halloween-web.png', hero, 1200, 800]]) {
    const f = path.join(OUT, name + '.html');
    fs.writeFileSync(f, html);
    const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    await pg.goto('file://' + f);
    await pg.waitForFunction(() => document.title === 'ready');
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(OUT, name) });
    fs.unlinkSync(f);
    await pg.close();
  }
  await b.close();
})();

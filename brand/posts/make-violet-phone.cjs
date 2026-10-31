// The owner's "glowing phone" reference (736x920) in MarketX colours: the white mark on the screen is cleaned off and the
// MarketX mark is set in its place (white, like the original), and the red light becomes the site's violet. Nothing else changes.
// Usage: node brand/posts/make-violet-phone.cjs REF.jpg OUT.png
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const [REF, OUT] = process.argv.slice(2).map(p => path.resolve(p));
const b64 = f => 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(f).toString('base64');
const MARK = b64(path.join(__dirname, '..', 'marketx-logo-flat-512.png'));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0}html,body{width:736px;height:920px;overflow:hidden;background:#000}.a{position:absolute}
</style></head><body>
<canvas id="c" width="736" height="920" class="a" style="left:0;top:0"></canvas>
<img class="a" src="${MARK}" style="left:${488 - 52}px;top:${458 - 52}px;width:104px;height:104px;transform:rotate(-2deg);filter:brightness(0) invert(1) drop-shadow(0 0 6px rgba(255,255,255,.35))">
<script>
const img = new Image(); img.onload = () => {
  const W = 736, H = 920, c = document.getElementById('c'), x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H), p = d.data;
  const at = (X, Y) => { const i = (Y * W + X) * 4; return [p[i], p[i + 1], p[i + 2]]; };
  const put = (X, Y, c) => { const i = (Y * W + X) * 4; p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; };
  // 1) the old mark: rebuilt from the screen around it (Coons patch, all four edges)
  const [x0, y0, x1, y1] = [428, 408, 546, 508];
  const T = [], B = [], L = [], R = [];
  for (let X = x0; X <= x1; X++) { T.push(at(X, y0)); B.push(at(X, y1)); }
  for (let Y = y0; Y <= y1; Y++) { L.push(at(x0, Y)); R.push(at(x1, Y)); }
  for (let Y = y0 + 1; Y < y1; Y++) for (let X = x0 + 1; X < x1; X++) {
    const s = (X - x0) / (x1 - x0), t = (Y - y0) / (y1 - y0), i = X - x0, j = Y - y0;
    put(X, Y, [0, 1, 2].map(k => Math.round((1 - t) * T[i][k] + t * B[i][k] + (1 - s) * L[j][k] + s * R[j][k]
      - ((1 - s) * (1 - t) * T[0][k] + s * (1 - t) * T[T.length - 1][k] + (1 - s) * t * B[0][k] + s * t * B[B.length - 1][k]))));
  }
  // 2) red/orange light → MarketX violet (#8b5cf6 family), same lightness and saturation; neutral pixels stay
  const toHsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    if (mx === mn) return [0, 0, l]; const dd = mx - mn, s = l > 0.5 ? dd / (2 - mx - mn) : dd / (mx + mn);
    let h = mx === r ? (g - b) / dd + (g < b ? 6 : 0) : mx === g ? (b - r) / dd + 2 : (r - g) / dd + 4; return [h * 60, s, l]; };
  const hue2 = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  const toRgb = (h, s, l) => { h = ((h % 360) + 360) % 360 / 360; if (!s) return [l, l, l].map(v => Math.round(v * 255));
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, pp = 2 * l - q; return [hue2(pp, q, h + 1 / 3), hue2(pp, q, h), hue2(pp, q, h - 1 / 3)].map(v => Math.round(v * 255)); };
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) {
    const o = at(X, Y), [h, s, l] = toHsl(...o);
    const hh = h > 180 ? h - 360 : h; // reds just under 360 count as negative
    const w = smooth(0.12, 0.32, s) * (1 - smooth(45, 70, Math.abs(hh - 8)));
    if (w <= 0) continue;
    const n = toRgb(262 + (hh - 8) * 0.5, s, l);
    put(X, Y, o.map((v, k) => Math.round(v + (n[k] - v) * w)));
  }
  x.putImageData(d, 0, 0);
  document.title = 'ready';
}; img.src = '${b64(REF)}';
</script></body></html>`;

(async () => {
  const f = OUT + '.html';
  fs.writeFileSync(f, html);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const pg = await b.newPage({ viewport: { width: 736, height: 920 }, deviceScaleFactor: 2 });
  await pg.goto('file://' + f);
  await pg.waitForFunction(() => document.title === 'ready');
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT });
  fs.unlinkSync(f);
  await b.close();
})();

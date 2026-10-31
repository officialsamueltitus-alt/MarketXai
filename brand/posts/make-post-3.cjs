// Usage: node brand/posts/make-post-3.cjs <reference image 1200x1499> <out.png> public/brand/marketx-logo-512.png (the reference is not kept in the repo)
// Post 3 on the owner's reference (1200x1499): the reference's own phone pixels are kept; its app tile and label are cleaned off
// the wallpaper and the MarketX tile + name are placed at the same perspective. The browser and the floating icon are redrawn
// at the reference's positions in MarketX colours. Output 1080x1350.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const REF = process.argv[2];
const OUT = process.argv[3];
const LOGO = process.argv[4];
const b64 = f => 'data:image/' + (f.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + fs.readFileSync(f).toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1080px;height:1350px;overflow:hidden;background:#0d1027}
body{font-family:Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#fff}
.a{position:absolute}
#w{position:absolute;left:0;top:0;width:1200px;height:1499px;transform:scale(0.9);transform-origin:0 0;overflow:hidden}
.ico{display:grid;place-items:center;background:radial-gradient(120% 120% at 30% 15%,#2a1650 0%,#120c22 55%,#07060c 100%)}
.ico img{width:80%;height:80%;object-fit:contain}
</style></head><body><div id="w">
<canvas id="c" width="1200" height="1499" class="a" style="left:0;top:0"></canvas>

<!-- Top: browser (reference positions) -->
<div class="a" style="left:0;top:0;width:1200px;height:795px;background:#262628"></div>
<div class="a" style="left:255px;top:148px;width:945px;height:647px;border-radius:44px 0 0 0;background:#1f1f22;overflow:hidden">
  <div class="a" style="left:62px;top:44px;display:flex;gap:26px">${['#ff5f57', '#febc2e', '#28c840'].map(c => `<span style="width:37px;height:37px;border-radius:50%;background:${c}"></span>`).join('')}</div>
  <div class="a" style="left:285px;top:20px;width:700px;height:110px;border-radius:30px 30px 0 0;background:#3b3b40"></div>
  <div class="a" style="left:255px;top:94px;width:32px;height:32px;background:radial-gradient(circle at 0 0,transparent 31px,#3b3b40 32px)"></div>
  <div class="a" style="left:310px;top:37px;width:50px;height:50px;border-radius:12px;background:#120c22;display:grid;place-items:center"><img src="${b64(LOGO)}" style="width:42px;height:42px"></div>
  <p class="a" style="left:385px;top:39px;font-size:37px;color:#e6e6ea;white-space:nowrap">MarketX - Home</p>
  <svg class="a" style="left:925px;top:52px" width="24" height="24" viewBox="0 0 24 24"><path d="M4 4l16 16M20 4L4 20" stroke="#bdbdc4" stroke-width="3" stroke-linecap="round"/></svg>
  <div class="a" style="left:0;top:122px;width:945px;height:147px;background:#3b3b40"></div>
  <svg class="a" style="left:45px;top:177px" width="42" height="36" viewBox="0 0 42 36"><path d="M40 18H5M17 5L4 18l13 13" stroke="#d4d4d8" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <svg class="a" style="left:155px;top:177px" width="42" height="36" viewBox="0 0 42 36"><path d="M2 18h35M25 5l13 13-13 13" stroke="#77777f" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <svg class="a" style="left:267px;top:175px" width="40" height="40" viewBox="0 0 40 40"><path d="M34 20a14 14 0 1 1-4.1-9.9M34 5v10h-10" stroke="#d4d4d8" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
  <div class="a" style="left:365px;top:144px;width:620px;height:103px;border-radius:52px;background:#28282c"></div>
  <div class="a" style="left:385px;top:159px;width:72px;height:72px;border-radius:50%;background:#3f3f45;display:grid;place-items:center"><svg width="34" height="30" viewBox="0 0 34 30"><g stroke="#d4d4d8" stroke-width="3" stroke-linecap="round" fill="none"><line x1="3" y1="8" x2="17" y2="8"/><line x1="17" y1="22" x2="31" y2="22"/><circle cx="25" cy="8" r="5"/><circle cx="9" cy="22" r="5"/></g></svg></div>
  <p class="a" style="left:480px;top:170px;font-size:39px;color:#e6e6ea">marketx.world</p>
  <div class="a" style="left:0;top:269px;width:945px;height:326px;background:linear-gradient(110deg,#7c3aed 0%,#a855f7 45%,#d946ef 100%)">
    <svg class="a" style="left:73px;top:148px" width="56" height="34" viewBox="0 0 56 34"><g fill="#0b0820"><rect width="56" height="6" rx="3"/><rect y="14" width="56" height="6" rx="3"/><rect y="28" width="56" height="6" rx="3"/></g></svg>
    <div class="a" style="left:215px;top:92px;display:flex;align-items:center;gap:22px"><img src="${b64(LOGO)}" style="width:128px;height:128px;filter:drop-shadow(0 10px 20px rgba(30,0,60,.45))"><span style="font-size:104px;font-weight:800;letter-spacing:-4px;color:#0b0820">MarketX</span></div>
  </div>
  <div class="a" style="left:0;top:595px;width:945px;height:52px;background:#0b0820"></div>
</div>

<!-- Floating 3D icon (reference position and size) -->
<div class="a" style="left:212px;top:966px;width:230px;height:220px;transform:rotate(-7deg)">
  <div class="a" style="left:14px;top:22px;width:212px;height:206px;border-radius:52px;background:linear-gradient(160deg,#3b1c78,#1a0d38)"></div>
  <div class="a ico" style="left:0;top:0;width:212px;height:206px;border-radius:52px;box-shadow:inset 0 2px 0 rgba(255,255,255,.18),0 40px 60px -25px rgba(139,92,246,.6)"><img src="${b64(LOGO)}"></div>
</div>
<div class="a" style="left:208px;top:938px;width:78px;height:78px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#ff7a6b,#e8352b 60%,#c4241c);border:3px solid rgba(255,255,255,.25);display:grid;place-items:center;font-size:42px;font-weight:600;box-shadow:0 8px 16px -6px rgba(0,0,0,.6)">1</div>

<!-- MarketX tile on the phone screen: the reference tile's corners TL(850,1160) TR(1000,1143) BL(907,1287) -->
<div class="a" style="left:0;top:0;width:100px;height:100px;transform-origin:0 0;transform:matrix(1.54,-0.23,0.56,1.25,845,1162)">
  <div class="a ico" style="left:-4px;top:-7px;width:108px;height:111px;border-radius:25px"></div>
</div>
<!-- The logo on the tile, drawn round and upright (only turned with the screen), centred on the tile -->
<img class="a" src="${b64(LOGO)}" style="left:${950 - 60}px;top:${1213 - 60}px;width:120px;height:120px;transform:rotate(-8.5deg);filter:drop-shadow(0 4px 8px rgba(0,0,0,.45))">
<!-- Its name, along the same slant as the reference label -->
<div class="a" style="left:0;top:0;transform-origin:0 0;transform:matrix(0.989,-0.148,0.47,0.883,922,1338)">
  <span style="display:block;font-size:33px;font-weight:500;letter-spacing:.6px;color:#f4f4f6;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.35);transform:translateY(-100%)">MarketX</span>
</div>
</div>
<script>
const img = new Image();
img.onload = () => {
  const c = document.getElementById('c'), x = c.getContext('2d');
  x.drawImage(img, 0, 0, 1200, 1499);
  const d = x.getImageData(0, 0, 1200, 1499), p = d.data, W = 1200;
  const at = (X, Y) => { const i = (Y * W + X) * 4; return [p[i], p[i + 1], p[i + 2]]; };
  const put = (X, Y, c) => { const i = (Y * W + X) * 4; p[i] = c[0]; p[i + 1] = c[1]; p[i + 2] = c[2]; };
  // Fills a column span by blending the pixels just outside it (the background there is a smooth gradient)
  const fill = (X, y0, y1) => { const a = at(X, y0), b = at(X, y1); for (let Y = y0 + 1; Y < y1; Y++) { const t = (Y - y0) / (y1 - y0); put(X, Y, a.map((v, k) => Math.round(v + (b[k] - v) * t))); } };
  // 1) the floating green icon (left)
  for (let X = 190; X <= 462; X++) fill(X, 920, 1232);
  // 2) the app label under the tile on the phone
  for (let X = 905; X <= 1070; X++) { const t = (X - 905) / 165; fill(X, Math.round(1297 - 21 * t), Math.round(1334 - 24 * t)); }
  // 3) any edge of the old green tile left around the new tile: each green pixel takes the colour of the wallpaper beside it
  const green = (c) => c[1] > 95 && c[1] > c[0] + 12 && c[1] > c[2] + 22;
  for (let pass = 0; pass < 6; pass++) for (let Y = 1125; Y <= 1305; Y++) for (let X = 830; X <= 1075; X++) {
    if (!green(at(X, Y))) continue;
    const ns = [[X - 3, Y], [X, Y + 3], [X - 3, Y + 3], [X + 3, Y], [X, Y - 3]].map(([a, b]) => at(a, b)).filter(c => !green(c));
    if (ns.length) put(X, Y, ns[0]);
  }
  x.putImageData(d, 0, 0);
  document.title = 'ready';
};
img.src = '${b64(REF)}';
</script></body></html>`;

(async () => {
  const f = path.join(path.dirname(OUT), 'post3.html');
  fs.writeFileSync(f, html);
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const pg = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
  await pg.goto('file://' + f);
  await pg.waitForFunction(() => document.title === 'ready');
  await pg.waitForTimeout(300);
  await pg.screenshot({ path: OUT });
  fs.unlinkSync(f);
  await b.close();
})();

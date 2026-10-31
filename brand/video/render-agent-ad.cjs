// Renders a frame-by-frame ad page (brand/video/agent-ad.html by default) at 30 fps and joins the frames into an MP4.
// Usage: node brand/video/render-agent-ad.cjs SPIN_DIR OUT.mp4 [--page site-ad.html] [--stills 2,9,16]
//   SPIN_DIR = transparent spin frames from `python3 brand/logo-spin.py SPIN_DIR --size 420 --transparent`
//   --stills writes PNGs at those seconds instead of the video (for checking a scene).
// The video is silent: the music is added afterwards.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');
const [SPIN, OUT] = process.argv.slice(2, 4).map(p => path.resolve(p));
const si = process.argv.indexOf('--stills');
const STILLS = si > 0 ? process.argv[si + 1].split(',').map(Number) : null;
const pi = process.argv.indexOf('--page');
const PAGE = pi > 0 ? process.argv[pi + 1] : 'agent-ad.html';
const FPS = 30;
const ROOT = path.join(__dirname, '..', '..');

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const pg = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  const frames = fs.readdirSync(SPIN).filter(f => f.endsWith('.png')).sort().map(f => 'file://' + path.join(SPIN, f));
  await pg.addInitScript(([s, icon]) => { window.SPIN = s; window.APPICON = icon; }, [frames, 'file://' + path.join(ROOT, 'public/brand/marketx-logo-128.png')]);
  await pg.goto('file://' + path.join(__dirname, PAGE));
  // load every spin frame once so swapping them never waits
  await pg.evaluate(async () => { await Promise.all(window.SPIN.map(u => { const i = new Image(); i.src = u; return i.decode().catch(() => {}); })); });
  const draw = t => pg.evaluate(async t => { window.render(t); await Promise.all([...document.images].map(i => (i.src ? i.decode().catch(() => {}) : 0))); }, t);
  if (STILLS) {
    for (const s of STILLS) { await draw(s); await pg.screenshot({ path: OUT.replace(/\.\w+$/, '') + `-${s}s.png` }); }
    await b.close();
    return;
  }
  const dur = await pg.evaluate(() => window.DURATION);
  const dir = OUT + '.frames';
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir);
  const n = Math.round(dur * FPS);
  for (let f = 0; f < n; f++) {
    await draw(f / FPS);
    await pg.screenshot({ path: path.join(dir, `f${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
    if (f % 150 === 0) console.log(`frame ${f}/${n}`);
  }
  await b.close();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart', OUT]);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('wrote', OUT);
})();

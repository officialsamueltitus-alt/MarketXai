// MarketX social posts: five 1080x1350 (4:5) designs built on the owner's reference layouts, in MarketX's own colours
// (rendered at 2x). Run from the repo root: node brand/posts/make-posts.cjs (needs playwright-core and the bundled Chromium).
// Honest copy only: MarketX is not in an app store, so no ratings, awards or store badges; real facts and marketx.world instead.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const DIR = __dirname;
fs.copyFileSync(path.join(DIR, '..', '..', 'public', 'brand', 'marketx-logo-512.png'), path.join(DIR, 'logo.png'));
fs.copyFileSync(path.join(DIR, '..', 'marketx-logo-flat-512.png'), path.join(DIR, 'flat.png'));

const css = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;height:1350px;overflow:hidden}
body{font-family:Inter,'Inter Display',system-ui,sans-serif;-webkit-font-smoothing:antialiased;color:#fff;background:#07070b;position:relative}
.abs{position:absolute}
.grain::after{content:'';position:absolute;inset:0;pointer-events:none;opacity:.07;mix-blend-mode:overlay;
 background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
/* App icon: dark squircle with the glossy ball */
.ico{border-radius:23%;background:radial-gradient(120% 120% at 30% 15%,#2a1650 0%,#120c22 55%,#07060c 100%);display:grid;place-items:center;position:relative;
 box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 18px 40px -18px rgba(139,92,246,.7)}
.ico img{width:80%;height:80%;object-fit:contain;filter:drop-shadow(0 6px 14px rgba(0,0,0,.45))}
.badge{position:absolute;top:-10%;right:-10%;width:34%;height:34%;border-radius:50%;background:#ff3b30;color:#fff;display:grid;place-items:center;font-weight:600;
 box-shadow:0 0 0 3px rgba(0,0,0,.15)}
/* Phone */
.phone{position:absolute;border-radius:120px;padding:16px;background:linear-gradient(145deg,#4a4a55,#18181d 40%,#3a3a44 70%,#121216);box-shadow:0 60px 120px -40px rgba(0,0,0,.9),inset 0 0 0 2px rgba(255,255,255,.08)}
.screen{width:100%;height:100%;border-radius:104px;overflow:hidden;position:relative;background:radial-gradient(90% 60% at 30% 10%,#2a1b55 0%,#0d0b18 55%,#07070b 100%)}
.island{position:absolute;top:28px;left:50%;transform:translateX(-50%);width:230px;height:66px;border-radius:40px;background:#000}
.time{position:absolute;top:42px;left:78px;font-weight:600;font-size:34px;letter-spacing:.5px}
.grid{position:absolute;display:grid;gap:44px 46px}
.app{display:flex;flex-direction:column;align-items:center;gap:14px;font-size:27px;color:#fff}
.tile{border-radius:23%;position:relative;display:grid;place-items:center;overflow:visible}
.cal{background:#fff;color:#111;flex-direction:column;display:flex;align-items:center;justify-content:center;line-height:1}
.cal b{color:#ff3b30;font-size:.2em;font-weight:600;letter-spacing:.04em}.cal span{font-size:.5em;font-weight:300;margin-top:.04em}
.mail{background:linear-gradient(180deg,#38a8ff,#1166f0)}
.notes{background:linear-gradient(180deg,#ffd52e 0 22%,#fff 22%);}
.clock{background:#111}
.cam{background:linear-gradient(180deg,#e4e4e7,#9ca3af)}
.wal{background:linear-gradient(160deg,#111827,#030712)}
.rem{background:#fff}
.photos{background:#fff}
.stores{background:linear-gradient(160deg,#8b5cf6,#d946ef)}
`;

const svg = {
  mail: s => `<svg width="${s * .62}" height="${s * .44}" viewBox="0 0 62 44"><rect x="1" y="1" width="60" height="42" rx="6" fill="#fff"/><path d="M3 4l28 22L59 4" stroke="#1d7cf2" stroke-width="4" fill="none" stroke-linejoin="round"/></svg>`,
  clock: s => `<svg width="${s * .8}" height="${s * .8}" viewBox="0 0 80 80"><circle cx="40" cy="40" r="37" fill="#fff"/><g stroke="#111" stroke-width="5" stroke-linecap="round"><line x1="40" y1="40" x2="40" y2="18"/><line x1="40" y1="40" x2="56" y2="48"/></g><line x1="40" y1="40" x2="28" y2="62" stroke="#f97316" stroke-width="2.5"/><circle cx="40" cy="40" r="3.5" fill="#f97316"/></svg>`,
  cam: s => `<svg width="${s * .62}" height="${s * .48}" viewBox="0 0 62 48"><rect x="2" y="9" width="58" height="37" rx="7" fill="#27272a"/><rect x="20" y="3" width="22" height="9" rx="3" fill="#27272a"/><circle cx="31" cy="28" r="12" fill="#e4e4e7"/><circle cx="31" cy="28" r="7" fill="#27272a"/></svg>`,
  rem: s => `<svg width="${s * .7}" height="${s * .6}" viewBox="0 0 70 60"><circle cx="10" cy="10" r="6" fill="#0a84ff"/><circle cx="10" cy="30" r="6" fill="#ff3b30"/><circle cx="10" cy="50" r="6" fill="#ff9f0a"/><g stroke="#d4d4d8" stroke-width="2"><line x1="24" y1="10" x2="66" y2="10"/><line x1="24" y1="30" x2="66" y2="30"/><line x1="24" y1="50" x2="66" y2="50"/></g></svg>`,
  wal: s => `<svg width="${s * .66}" height="${s * .5}" viewBox="0 0 66 50"><rect x="2" y="2" width="62" height="30" rx="6" fill="#8b5cf6"/><rect x="2" y="10" width="62" height="30" rx="6" fill="#22d3ee"/><rect x="2" y="18" width="62" height="30" rx="6" fill="#f4f4f5"/></svg>`,
  photos: s => `<svg width="${s * .76}" height="${s * .76}" viewBox="-40 -40 80 80">${['#a855f7', '#6366f1', '#0ea5e9', '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899'].map((c, i) => `<ellipse cx="0" cy="-17" rx="11" ry="19" fill="${c}" opacity=".85" transform="rotate(${i * 45})"/>`).join('')}</svg>`,
};
const tile = (kind, s, extra = '') => {
  if (kind === 'mx') return `<div class="ico" style="width:${s}px;height:${s}px">${extra}<img src="logo.png"></div>`;
  if (kind === 'cal') return `<div class="tile cal" style="width:${s}px;height:${s}px;font-size:${s}px"><b>MON</b><span>6</span></div>`;
  return `<div class="tile ${kind}" style="width:${s}px;height:${s}px">${svg[kind] ? svg[kind](s) : ''}</div>`;
};
const app = (kind, label, s, extra) => `<div class="app">${tile(kind, s, extra)}<span>${label}</span></div>`;
const phoneShell = (inner, { x, y, w, h, rot = 0 }) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;transform:rotate(${rot}deg)"><div class="screen">${inner}</div></div>`;

const page = (body, bg) => `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="grain" style="background:${bg}">${body}</body></html>`;

// 1. "Open MarketX" card + tilted phone (reference 1, matched to its measurements: drawn on the reference's 1164x1454 grid,
// then scaled to 1080x1350; the phone uses the reference's perspective as a 2D matrix with its corner at (350, 596))
const P1 = (inner) => page(`<div style="position:absolute;left:0;top:0;width:1164px;height:1454px;transform:scale(${1080 / 1164});transform-origin:0 0;overflow:hidden">${inner}</div>`, '#000');
const lbl = t => `<span style="position:absolute;left:-40px;right:-40px;top:206px;text-align:center;font-size:44px;font-weight:500;color:#fff">${t}</span>`;
const post1 = P1(`
<div class="abs" style="inset:0;background:radial-gradient(38% 30% at 92% 4%,rgba(124,58,237,.75),transparent 72%),radial-gradient(34% 30% at 0% 92%,rgba(192,38,211,.55),transparent 72%),radial-gradient(40% 25% at 60% 0%,rgba(76,29,149,.45),transparent 70%),#000"></div>
<div class="abs" style="left:53px;top:152px;width:709px;height:538px;border-radius:62px;background:#fff;color:#0b0b12;overflow:hidden">
  <div class="abs" style="left:22px;top:30px;display:flex;align-items:center;gap:16px;color:#7c3aed;font-size:31px;letter-spacing:-.2px">
    <svg width="24" height="40" viewBox="0 0 24 40"><path d="M20 3L4 20l16 17" stroke="#7c3aed" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>marketx.world</div>
  <div class="abs" style="left:30px;top:90px">${tile('mx', 222).replace('class="ico"', 'class="ico" style="border-radius:52px;box-shadow:none"').replace('style="border-radius:52px;box-shadow:none" style="', 'style="border-radius:52px;box-shadow:none;')}</div>
  <p class="abs" style="left:287px;top:122px;font-size:37px;font-weight:700;letter-spacing:-.3px">MarketX</p>
  <p class="abs" style="left:287px;top:174px;font-size:24px;font-weight:500;letter-spacing:.2px;background:linear-gradient(90deg,#7c3aed,#0ea5e9);-webkit-background-clip:text;color:transparent">SpiriTech Labs</p>
  <div class="abs" style="left:278px;top:253px;width:129px;height:50px;border-radius:26px;background:linear-gradient(110deg,#8b5cf6,#c026d3);color:#fff;font-size:27px;display:grid;place-items:center;letter-spacing:.5px">OPEN</div>
  <svg class="abs" style="left:630px;top:257px" width="36" height="44" viewBox="0 0 36 44"><path d="M18 3v25M10 11l8-8 8 8" stroke="#7c3aed" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 17H4v24h28V17h-4" stroke="#7c3aed" stroke-width="3" fill="none" stroke-linejoin="round"/></svg>
  <div class="abs" style="left:36px;right:0;top:339px;height:2px;background:#e5e5ea"></div>
  ${[['PLAN', 'Free', 'To start'], ['LIVE MARKETS', '29+', 'Live prices'], ['ENGINE', 'SI', 'Super Intelligence'], ['PROOF', 'Solana', '']].map(([l, v, c], i) => `
   <div class="abs" style="left:${21 + i * 204}px;top:364px;width:204px;text-align:center;color:#8e8e93">
     <p style="font-size:19px;letter-spacing:.06em">${l}</p>
     <p style="margin-top:15px;font-size:40px;font-weight:600;color:#6e6e76;letter-spacing:-.3px;line-height:1">${v}</p>
     <p style="margin-top:16px;font-size:19px">${c}</p>
   </div>${i ? `<div class="abs" style="left:${21 + i * 204}px;top:384px;width:2px;height:70px;background:#e5e5ea"></div>` : ''}`).join('')}
</div>
<div class="abs" style="left:0;top:0;width:1400px;height:2900px;transform-origin:0 0;transform:matrix(0.989,-0.148,0.4785,0.878,350,596)">
  <div class="abs" style="left:-64px;top:22px;width:1400px;height:2900px;border-radius:285px;background:linear-gradient(90deg,#141416 0%,#3f3f45 18%,#1b1b1e 40%,#111113 100%)"></div>
  <div class="abs" style="left:-62px;top:625px;width:16px;height:156px;border-radius:8px;background:linear-gradient(90deg,#55555c,#c9c9cf 45%,#3a3a40);box-shadow:0 0 0 2px #0b0b0d"></div>
  <div class="abs" style="left:-30px;top:0;width:1400px;height:2900px;border-radius:280px;background:linear-gradient(135deg,#5a5a61 0%,#2a2a2e 22%,#46464d 48%,#1f1f22 70%,#3a3a40 100%);box-shadow:inset 0 0 0 3px rgba(255,255,255,.14)"></div>
  <div class="abs" style="left:-12px;top:18px;width:1364px;height:2864px;border-radius:262px;background:#050506"></div>
  <div class="abs" style="left:4px;top:34px;width:1332px;height:2832px;border-radius:246px;background:radial-gradient(70% 40% at 30% 12%,#1c1338 0%,#06050b 60%,#000 100%);overflow:hidden">
    <div class="abs" style="left:540px;top:60px;width:330px;height:104px;border-radius:60px;background:#000"></div>
    <p class="abs" style="left:236px;top:90px;font-size:62px;font-weight:600;letter-spacing:1px">9:41</p>
    <div class="abs" style="left:172px;top:290px;width:186px;height:186px">${tile('mx', 186).replace('class="ico"', 'class="ico" style="border-radius:44px"').replace('style="border-radius:44px" style="', 'style="border-radius:44px;')}${lbl('MarketX')}</div>
    <div class="abs" style="left:484px;top:290px;width:186px;height:186px">${tile('cal', 186).replace('font-size:186px', 'font-size:186px;border-radius:44px')}${lbl('Calendar')}</div>
    <div class="abs" style="left:172px;top:604px;width:186px;height:186px">${tile('mail', 186).replace('width:186px;height:186px', 'width:186px;height:186px;border-radius:44px')}${lbl('Mail')}</div>
    <div class="abs" style="left:484px;top:604px;width:186px;height:186px">${tile('notes', 186).replace('width:186px;height:186px', 'width:186px;height:186px;border-radius:44px')}${lbl('Notes')}</div>
  </div>
</div>
<div class="abs" style="left:0;right:0;top:1348px;bottom:0;background:#141416;z-index:2">
  <div class="abs" style="left:100px;top:34px"><p style="font-weight:800;letter-spacing:.16em;font-size:23px;line-height:1">MARKETX</p><p style="margin-top:8px;font-size:10.5px;letter-spacing:.34em;color:#a1a1aa">YOUR TRADING CO-PILOT</p></div>
  <div class="abs" style="right:100px;top:44px;display:flex;align-items:center;gap:16px;font-size:16px;color:#e4e4e7;letter-spacing:.03em">
    <span style="display:flex;align-items:center;gap:8px"><img src="logo.png" style="width:20px;height:20px">marketx.world</span><span style="color:#71717a">|</span>
    <span style="display:flex;align-items:center;gap:8px"><svg width="18" height="18" viewBox="0 0 24 24"><path d="M18.2 2.5h3.4l-7.4 8.5 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.9 2.5h7l4.8 6.4 5.5-6.4zm-1.2 18h1.9L7.1 4.4H5.1l11.9 16.1z" fill="#e4e4e7"/></svg>@_MarketX</span>
  </div>
</div>`);

// 2. Floating card + home screen (reference 2)
const post2 = page(`
<div class="abs" style="inset:0;background:linear-gradient(170deg,#0b0820 0%,#2a1060 30%,#6d28d9 62%,#c026d3 100%)"></div>
<div class="abs" style="left:325px;top:640px;width:550px;height:140px;border-radius:0 0 44px 44px;background:#d9d2ec"></div>
<div class="abs" style="left:285px;top:600px;width:630px;height:140px;border-radius:0 0 50px 50px;background:#ece7f8"></div>
<div class="abs" style="left:150px;top:290px;width:780px;height:350px;border-radius:70px;background:#f7f5ff;color:#0b0b12;box-shadow:0 40px 80px -40px rgba(20,0,60,.7)">
  <div class="abs" style="left:52px;top:50px">${tile('mx', 250)}</div>
  <p class="abs" style="left:344px;top:72px;font-size:56px;font-weight:800;letter-spacing:-1.5px">MarketX</p>
  <span class="abs" style="left:680px;top:86px;font-size:20px;font-weight:600;color:#6d28d9;border:2px solid #c4b5fd;border-radius:10px;padding:4px 10px">SI</span>
  <p class="abs" style="left:346px;top:152px;font-size:22px;color:#3f3f46">Clear setups. Proof on chain.</p>
  <div class="abs" style="left:346px;top:204px;display:flex;gap:10px">
    ${['Analysis', 'Agent', 'Proof'].map(t => `<span style="font-size:19px;font-weight:600;color:#5b21b6;background:#ede9fe;border-radius:999px;padding:7px 15px">${t}</span>`).join('')}
  </div>
  <p class="abs" style="left:348px;top:268px;font-size:21px;color:#27272a"><b>Plans:</b> Free to start · Pro from $30</p>
</div>
${phoneShell(`<div class="island"></div><div class="time" style="left:86px;top:52px">9:41</div>
 <svg class="abs" style="right:80px;top:56px" width="120" height="26" viewBox="0 0 120 26"><g fill="#fff"><rect x="0" y="16" width="6" height="10" rx="2"/><rect x="10" y="11" width="6" height="15" rx="2"/><rect x="20" y="6" width="6" height="20" rx="2"/><rect x="30" y="1" width="6" height="25" rx="2"/></g><rect x="70" y="3" width="42" height="21" rx="6" fill="none" stroke="#fff" stroke-width="2" opacity=".7"/><rect x="73" y="6" width="30" height="15" rx="3" fill="#fff"/></svg>
 <div class="grid" style="left:52px;top:200px;grid-template-columns:repeat(4,150px);gap:46px 32px">
  ${app('mx', 'MarketX', 150, '<span class="badge" style="font-size:30px">2</span>')}${app('cal', 'Calendar', 150)}${app('photos', 'Photos', 150)}${app('cam', 'Camera', 150)}
  ${app('mail', 'Mail', 150)}${app('notes', 'Notes', 150)}${app('rem', 'Reminders', 150)}${app('clock', 'Clock', 150)}
 </div>`, { x: 190, y: 860, w: 830, h: 1100 })}
`, '#0b0820');

// 3. Browser tab + 3D icon + tilted phone (reference 3)
const post3 = page(`
<div class="abs" style="left:0;top:0;right:0;height:660px;background:#1d1d22"></div>
<div class="abs" style="left:0;top:660px;right:0;bottom:0;background:radial-gradient(70% 60% at 20% 30%,#1c1440 0%,#0a0916 60%)"></div>
<div class="abs" style="left:230px;top:130px;width:900px;height:530px;border-radius:36px 0 0 0;background:#2a2a31;overflow:hidden">
  <div class="abs" style="left:50px;top:42px;display:flex;gap:22px">${['#ff5f57', '#febc2e', '#28c840'].map(c => `<span style="width:30px;height:30px;border-radius:50%;background:${c}"></span>`).join('')}</div>
  <div class="abs" style="left:250px;top:16px;width:700px;height:96px;border-radius:26px 26px 0 0;background:#3b3b44;display:flex;align-items:center;gap:20px;padding:0 30px">
   <span style="width:46px;height:46px;border-radius:12px;background:#120c22;display:grid;place-items:center"><img src="logo.png" style="width:38px;height:38px"></span>
   <span style="font-size:32px;color:#e4e4e7;white-space:nowrap">MarketX · Your Trading Co-Pilot</span></div>
  <div class="abs" style="left:0;right:0;top:112px;height:120px;background:#3b3b44;display:flex;align-items:center;gap:46px;padding:0 50px;color:#a1a1aa">
   <svg width="40" height="34" viewBox="0 0 40 34"><path d="M38 17H4M16 4L3 17l13 13" stroke="#d4d4d8" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
   <svg width="40" height="34" viewBox="0 0 40 34"><path d="M2 17h34M24 4l13 13-13 13" stroke="#71717a" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
   <svg width="36" height="36" viewBox="0 0 36 36"><path d="M31 18a13 13 0 1 1-4-9.4M31 4v9h-9" stroke="#d4d4d8" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
   <div style="flex:1;height:84px;border-radius:44px;background:#26262c;display:flex;align-items:center;gap:22px;padding:0 20px"><span style="width:58px;height:58px;border-radius:50%;background:#3b3b44;display:grid;place-items:center"><svg width="26" height="24" viewBox="0 0 26 24"><g stroke="#d4d4d8" stroke-width="2.6" stroke-linecap="round"><line x1="2" y1="6" x2="14" y2="6"/><line x1="12" y1="18" x2="24" y2="18"/><circle cx="20" cy="6" r="4" fill="none"/><circle cx="6" cy="18" r="4" fill="none"/></g></svg></span><span style="font-size:38px;color:#e4e4e7">marketx.world</span></div>
  </div>
  <div class="abs" style="left:0;right:0;top:232px;height:330px;background:linear-gradient(110deg,#7c3aed 0%,#a855f7 45%,#d946ef 100%);display:flex;align-items:center;gap:70px;padding:0 70px">
   <svg width="54" height="40" viewBox="0 0 54 40"><g fill="#fff"><rect y="0" width="54" height="7" rx="3.5"/><rect y="16" width="54" height="7" rx="3.5"/><rect y="33" width="54" height="7" rx="3.5"/></g></svg>
   <div style="display:flex;align-items:center;gap:22px"><img src="logo.png" style="width:120px;height:120px;filter:drop-shadow(0 10px 18px rgba(30,0,60,.45))"><span style="font-size:110px;font-weight:800;letter-spacing:-4px">MarketX</span></div>
  </div>
</div>
<div class="abs" style="left:190px;top:880px;transform:perspective(900px) rotateY(18deg) rotateX(14deg) rotateZ(-6deg)">
  <div style="position:absolute;left:14px;top:22px;width:250px;height:250px;border-radius:60px;background:#1b0f36"></div>
  <div class="ico" style="width:250px;height:250px;border-radius:60px;box-shadow:inset 0 2px 0 rgba(255,255,255,.18),0 50px 70px -30px rgba(139,92,246,.75)"><img src="logo.png"><span class="badge" style="font-size:44px;width:84px;height:84px;top:-30px;right:auto;left:-26px;background:linear-gradient(160deg,#ff6b5e,#e5302a)">1</span></div>
</div>
${phoneShell(`<div class="island" style="left:auto;right:-60px;transform:none"></div><div class="time" style="left:150px;top:120px;font-size:52px">9:41</div>
 <div class="abs" style="inset:0;background:radial-gradient(70% 50% at 70% 30%,rgba(139,92,246,.45),transparent 70%),linear-gradient(200deg,#3b3d4a,#121218 60%)"></div>
 <div class="grid" style="left:150px;top:300px;grid-template-columns:repeat(2,240px);gap:60px 60px">
  ${app('mx', 'MarketX', 240)}${app('cal', 'Calendar', 240)}${app('mail', 'Mail', 240)}${app('notes', 'Notes', 240)}
 </div>`, { x: 620, y: 860, w: 820, h: 1400, rot: -20 }).replace(/<span>(MarketX|Calendar|Mail|Notes)<\/span>/g, '<span style="font-size:40px">$1</span>').replace('<div class="screen">', '<div class="screen" style="background:#121218">').replace('class="phone"', 'class="phone" style="background:linear-gradient(145deg,#c9a27a,#6e4f33 45%,#d8b38a 70%,#5a3f28)"').replace('style="background:linear-gradient(145deg,#c9a27a,#6e4f33 45%,#d8b38a 70%,#5a3f28)" style="', 'style="background:linear-gradient(145deg,#a78bfa,#4c1d95 45%,#c4b5fd 70%,#3b0764);')}
`, '#0a0916');

// 4. The glowing tile (reference 4's mood, no person)
const post4 = page(`
<div class="abs" style="inset:0;background:radial-gradient(55% 45% at 62% 50%,rgba(168,85,247,.85) 0%,rgba(91,33,182,.55) 35%,rgba(20,8,40,.9) 70%,#050308 100%)"></div>
<div class="abs" style="inset:0;background:radial-gradient(30% 25% at 64% 50%,rgba(217,70,239,.45),transparent 70%)"></div>
<div class="abs" style="left:300px;top:380px;width:560px;height:560px;border-radius:50%;background:radial-gradient(circle,rgba(217,70,239,.55),transparent 65%);filter:blur(30px)"></div>
<div class="abs" style="left:380px;top:420px;transform:perspective(1100px) rotateY(-24deg) rotateX(8deg) rotateZ(4deg)">
  <div style="position:absolute;left:22px;top:18px;width:420px;height:420px;border-radius:92px;background:#2a0f4f"></div>
  <div style="position:relative;width:420px;height:420px;border-radius:92px;background:linear-gradient(150deg,#a855f7 0%,#7c3aed 45%,#c026d3 100%);display:grid;place-items:center;
    box-shadow:0 0 0 6px rgba(255,255,255,.12) inset,0 0 140px 30px rgba(192,38,211,.55),0 0 60px rgba(168,85,247,.9)">
    <img src="flat.png" style="width:250px;height:250px;filter:brightness(0) invert(1) drop-shadow(0 0 22px rgba(255,255,255,.75))">
  </div>
</div>
<div class="abs" style="left:80px;top:90px">
  <div style="display:flex;align-items:center;gap:16px"><img src="logo.png" style="width:64px;height:64px"><span style="font-size:36px;font-weight:700;letter-spacing:-.5px">MarketX</span></div>
</div>
<div class="abs" style="left:80px;bottom:110px;right:80px">
  <p style="font-size:84px;font-weight:700;letter-spacing:-3px;line-height:1.02">Your trading<br>co-pilot.</p>
  <p style="margin-top:22px;font-size:28px;color:rgba(255,255,255,.75)">One prompt. A clear plan. Proof on chain.</p>
  <p style="margin-top:30px;font-size:22px;letter-spacing:.2em;color:rgba(255,255,255,.55)">MARKETX.WORLD</p>
</div>
`, '#050308');

// 5. The Trading Agent (reference 5)
const post5 = page(`
<div class="abs" style="inset:0;background:linear-gradient(180deg,#0a0620 0%,#2b1572 38%,#5b21b6 62%,#8b5cf6 100%)"></div>
<p class="abs" style="left:0;right:0;top:150px;text-align:center;font-size:80px;font-weight:700;letter-spacing:-3.5px;line-height:1.02">Set it once.<br>Your agent trades the plan.</p>
<div class="abs" style="left:226px;top:420px;width:640px;height:1000px;border-radius:84px;padding:14px;background:#141418;box-shadow:0 50px 100px -40px rgba(0,0,0,.8)">
 <div style="width:100%;height:100%;border-radius:72px;background:#f4f4f7;position:relative;overflow:hidden;color:#18181b">
  <div class="abs" style="left:50%;top:0;transform:translateX(-50%);width:300px;height:56px;border-radius:0 0 30px 30px;background:#141418"></div>
  <p class="abs" style="left:56px;top:30px;font-size:28px;font-weight:600">9:41</p>
  <p class="abs" style="left:56px;top:130px;font-size:24px;color:#a1a1aa">Trading Agent</p>
  ${[['Steady mode', true], ['Risk per trade', '0.5%'], ['Markets', 'Gold · BTC · USD/JPY']].map(([k, v], i) => `
   <div class="abs" style="left:56px;right:56px;top:${190 + i * 112}px;height:112px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px dashed #d4d4d8">
    <span style="font-size:30px;font-weight:500">${k}</span>
    ${v === true ? '<span style="width:96px;height:56px;border-radius:30px;background:linear-gradient(110deg,#8b5cf6,#d946ef);position:relative"><span style="position:absolute;right:5px;top:5px;width:46px;height:46px;border-radius:50%;background:#fff"></span></span>' : `<span style="font-size:24px;color:#6b7280">${v} ›</span>`}
   </div>`).join('')}
 </div>
</div>
<div class="abs" style="left:196px;top:720px;width:690px;height:470px;border-radius:64px;background:linear-gradient(160deg,#7c3aed,#4f46e5);box-shadow:0 40px 80px -30px rgba(30,10,90,.8)">
  <svg class="abs" style="right:44px;top:30px" width="34" height="34" viewBox="0 0 34 34"><path d="M5 5l24 24M29 5L5 29" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>
  <div class="abs" style="left:32px;right:32px;top:80px;height:320px;border-radius:44px;background:rgba(10,6,40,.55);border:1px solid rgba(255,255,255,.08)">
    <div class="abs" style="left:28px;top:24px;display:flex;align-items:center;gap:10px"><img src="logo.png" style="width:48px;height:48px"><span style="font-size:20px;font-weight:600;color:#ddd6fe">Agent · running</span></div>
    <span class="abs" style="right:28px;top:34px;font-size:15px;color:rgba(255,255,255,.5)">Example screen</span>
    <svg class="abs" style="left:70px;top:70px" width="490" height="250" viewBox="0 0 490 250">
      <defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset=".5" stop-color="#c084fc"/><stop offset="1" stop-color="#818cf8"/></linearGradient></defs>
      <path d="M30 230 A215 215 0 0 1 460 230" stroke="rgba(255,255,255,.12)" stroke-width="26" fill="none" stroke-linecap="round"/>
      <path d="M30 230 A215 215 0 0 1 400 95" stroke="url(#g)" stroke-width="26" fill="none" stroke-linecap="round"/>
      ${Array.from({ length: 40 }, (_, i) => { const a = Math.PI * (1 - i / 39); const r1 = 180, r2 = 192; return `<line x1="${245 + r1 * Math.cos(a)}" y1="${230 - r1 * Math.sin(a)}" x2="${245 + r2 * Math.cos(a)}" y2="${230 - r2 * Math.sin(a)}" stroke="rgba(255,255,255,.25)" stroke-width="2"/>`; }).join('')}
    </svg>
    <p class="abs" style="left:0;right:0;top:170px;text-align:center;font-size:86px;font-weight:700;letter-spacing:-2px">78<span style="font-size:40px;color:#c4b5fd">/100</span></p>
    <p class="abs" style="left:0;right:0;top:272px;text-align:center;font-size:22px;color:#ddd6fe">Setup quality · XAU/USD 1H</p>
  </div>
  <div class="abs" style="left:0;right:0;top:416px;display:flex;justify-content:center;gap:40px;font-size:23px;font-weight:600">
    <span><span style="color:#fbbf24">◆</span> Limit at zone</span><span><span style="color:#22d3ee">◆</span> 3.4R</span><span><span style="color:#34d399">◆</span> MT5 linked</span>
  </div>
  
</div>
<div class="abs" style="left:800px;top:380px;transform:rotate(10deg)">${tile('mx', 210)}</div>
<div class="abs" style="left:860px;top:620px;width:130px;height:130px;border-radius:50%;background:#111;display:grid;place-items:center;box-shadow:0 20px 40px -14px rgba(0,0,0,.7)">
  <svg width="86" height="70" viewBox="0 0 86 70"><g stroke-linecap="round"><line x1="14" y1="8" x2="14" y2="62" stroke="#34d399" stroke-width="3"/><rect x="8" y="22" width="12" height="26" rx="3" fill="#34d399"/><line x1="43" y1="4" x2="43" y2="56" stroke="#f43f5e" stroke-width="3"/><rect x="37" y="14" width="12" height="28" rx="3" fill="#f43f5e"/><line x1="72" y1="10" x2="72" y2="66" stroke="#a78bfa" stroke-width="3"/><rect x="66" y="20" width="12" height="34" rx="3" fill="#a78bfa"/></g></svg>
</div>
<div class="abs" style="left:40px;top:960px;width:210px;height:210px;border-radius:56px;transform:rotate(-8deg);background:linear-gradient(160deg,#38bdf8,#6366f1);display:grid;place-items:center;box-shadow:inset 0 2px 0 rgba(255,255,255,.35),0 30px 50px -20px rgba(30,10,90,.8)">
  <svg width="130" height="130" viewBox="0 0 130 130"><rect x="22" y="38" width="86" height="66" rx="22" fill="#fff" opacity=".95"/><circle cx="50" cy="70" r="9" fill="#6366f1"/><circle cx="80" cy="70" r="9" fill="#6366f1"/><line x1="65" y1="38" x2="65" y2="18" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="65" cy="16" r="8" fill="#fff"/></svg>
</div>
<div class="abs" style="right:40px;bottom:28px;height:100px;padding:0 34px 0 22px;border-radius:60px;background:rgba(18,10,46,.78);border:1px solid rgba(196,181,253,.35);box-shadow:0 20px 40px -18px rgba(0,0,0,.7);display:flex;align-items:center;gap:18px;backdrop-filter:blur(10px)">
  <img src="logo.png" style="width:66px;height:66px"><div><p style="font-size:20px;color:rgba(255,255,255,.85)">Start it on</p><p style="font-size:36px;font-weight:600;letter-spacing:-.5px">marketx.world</p></div>
</div>
<div class="abs" style="left:70px;bottom:72px;display:flex;gap:12px">${[0, 0, 0, 0, 1, 0, 0].map(on => `<span style="width:${on ? 52 : 10}px;height:10px;border-radius:6px;background:rgba(255,255,255,${on ? .95 : .35})"></span>`).join('')}</div>
`, '#0a0620');

(async () => {
  const posts = { 'marketx-post-1-open': post1, 'marketx-post-2-home': post2, 'marketx-post-3-web': post3, 'marketx-post-4-glow': post4, 'marketx-post-5-agent': post5 };
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome' });
  const p = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 2 });
  for (const [name, html] of Object.entries(posts)) {
    const f = path.join(DIR, `${name}.html`);
    fs.writeFileSync(f, html);
    await p.goto('file://' + f);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(DIR, `${name}.png`) });
    fs.unlinkSync(f);
    console.log(name);
  }
  await b.close();
  for (const f of ['logo.png', 'flat.png']) fs.unlinkSync(path.join(DIR, f));
})();

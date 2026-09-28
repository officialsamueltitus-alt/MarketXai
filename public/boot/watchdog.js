// Boot watchdog: if the app script fails to load or run (old browser, network, crash), show a message instead of a blank page
(function () {
  var shown = false;
  function el(tag, style, text) {
    var n = document.createElement(tag);
    n.setAttribute('style', style);
    if (text) n.textContent = text;
    return n;
  }
  function showFallback(detail) {
    var root = document.getElementById('root');
    if (shown || !root || root.children.length > 0) return;
    shown = true;
    var wrap = el('div', 'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#09090b;color:#e2e8f0;font-family:system-ui,sans-serif;text-align:center');
    var box = el('div', 'max-width:420px');
    box.appendChild(el('h1', 'font-size:20px;font-weight:700;margin:0 0 8px', 'MarketX could not load'));
    box.appendChild(el('p', 'font-size:14px;color:#94a3b8;margin:0 0 16px', 'Please check your connection and reload. If it keeps happening, update your browser.'));
    var btn = el('button', 'padding:10px 18px;border-radius:12px;background:#4f46e5;color:#fff;font-weight:600;border:0', 'Reload');
    btn.addEventListener('click', function () { location.reload(); });
    box.appendChild(btn);
    if (detail) box.appendChild(el('p', 'font-size:11px;color:#64748b;margin-top:16px;word-break:break-word', String(detail)));
    wrap.appendChild(box);
    root.appendChild(wrap);
  }
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    var ownScriptFailed = t && t.tagName === 'SCRIPT' && t.src && t.src.indexOf(location.host) !== -1;
    var runtimeError = !t || t === window;
    if (!ownScriptFailed && !runtimeError) return; // ignore third-party resources (fonts, Paystack, images)
    var detail = runtimeError ? e.message : 'Failed to load ' + t.src;
    setTimeout(function () { showFallback(detail); }, 1500);
  }, true);
  setTimeout(function () { showFallback('Timed out while loading.'); }, 15000);
})();

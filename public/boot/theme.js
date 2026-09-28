// Apply the saved theme before first paint (no flash)
(function () {
  try {
    var p = localStorage.getItem('mx_theme') || 'dark';
    var t = p === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p;
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
  } catch (e) {}
})();

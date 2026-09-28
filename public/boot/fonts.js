// Non-render-blocking web fonts: switch the print-only stylesheet on once it has loaded
(function () {
  var link = document.getElementById('mx-fonts');
  if (!link) return;
  function on() { link.media = 'all'; }
  if (link.sheet) on();
  else link.addEventListener('load', on);
})();

// Apply the saved theme/palette/room scene before first paint (no flash). Loaded as a blocking classic script from
// index.html (a separate file because the backend's CSP blocks inline scripts). Keep in sync with ThemeMenu in App.jsx.
(function () {
  var d = document.documentElement, t = null, p = null, s = null, a = null;
  try { t = localStorage.getItem('neko.theme'); p = localStorage.getItem('neko.palette'); s = localStorage.getItem('neko.scene'); a = localStorage.getItem('neko.animal'); } catch (e) { /* storage blocked */ }
  if (t === 'light' || t === 'dark') {
    d.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name=color-scheme]');
    if (meta) meta.content = t;
  }
  if (p === 'mint' || p === 'lavender' || p === 'peach') d.setAttribute('data-palette', p);
  if (s === 'magic' || s === 'fairy' || s === 'cafe' || s === 'kitchen') d.setAttribute('data-scene', s);
  if (a === 'dog' || a === 'bunny' || a === 'bear' || a === 'fox') d.setAttribute('data-animal', a);
})();

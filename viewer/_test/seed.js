// _test/seed.js — siembra progreso antes de app.js para probar reanudar, chips y prefs.
(function () {
  try {
    var data = window.PLATZI_LOCAL;
    if (!data || !data.courses) return;
    var c = null;
    for (var i = 0; i < data.courses.length; i++) if (data.courses[i].slug === 'claude-code') c = data.courses[i];
    if (!c) return;
    var m = c.modules[0];
    var f1 = m.classes[0];
    var f2 = m.classes[1] || f1;
    var now = Date.now();
    var watched = {};
    watched[c.slug + '|' + f1.src] = { done: false, pos: 42, at: now };
    if (f2 !== f1) watched[c.slug + '|' + f2.src] = { done: true, pos: 300, at: now - 60000 };
    window.localStorage.setItem('platziLocal.v1', JSON.stringify({
      v: 1,
      watched: watched,
      prefs: { speed: 1.5, captions: 'es', autoplayNext: false, volume: 0.25 },
      last: { slug: c.slug, src: f1.src, at: now }
    }));
  } catch (e) { /* sin storage: el caso ya lo cubre el fixture nostorage */ }
})();

/* Platzi Local — comportamiento del visor offline (ver viewer/SPEC.md §5).
   Vanilla, sin módulos ni dependencias: tiene que correr también con file://. */
(function () {
  'use strict';

  var STORAGE_KEY = 'platziLocal.v1';
  var SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  var LANGS = ['es', 'en', 'pt'];
  var TRACK_LABEL = { es: 'Español', en: 'English', pt: 'Português' };
  var MSG_STORAGE = 'Tu progreso no se guardará en esta sesión';
  var MSG_VIDEO = 'No se pudo cargar el video. Revisa que el archivo exista en Courses/.';

  var appEl = document.getElementById('app');
  var chipEl = document.getElementById('resume-chip');
  var searchInput = document.getElementById('search-input');
  var searchBox = document.getElementById('search-results');
  var searchWrap = document.getElementById('searchbox');
  var bannerEl = document.getElementById('banner-file');

  var DATA = (typeof window.PLATZI_LOCAL === 'object' && window.PLATZI_LOCAL) ? window.PLATZI_LOCAL : null;
  var courses = (DATA && Array.isArray(DATA.courses)) ? DATA.courses : [];
  var routeList = (DATA && Array.isArray(DATA.routes)) ? DATA.routes : [];

  /* ---------- formato y utilidades ---------- */

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(n, lo, hi) {
    n = Math.floor(Number(n));
    if (!isFinite(n)) return lo;
    return n < lo ? lo : (n > hi ? hi : n);
  }

  function clamp01(n) { return !isNum(n) ? 1 : (n < 0 ? 0 : (n > 1 ? 1 : n)); }

  function fmtTime(sec) {
    if (!isNum(sec) || sec < 0) return '—';
    var s = Math.floor(sec);
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s % 60);
    return m + ':' + pad2(s % 60);
  }

  function fmtDuration(sec) {
    if (!isNum(sec) || sec <= 0) return null;
    var total = Math.max(1, Math.round(sec / 60));
    var h = Math.floor(total / 60);
    var m = total % 60;
    if (h && m) return h + ' h ' + m + ' min';
    if (h) return h + ' h';
    return m + ' min';
  }

  function fmtHours(h) { return isNum(h) ? fmtDuration(h * 3600) : null; }

  var MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  function splitDate(v) {
    if (typeof v !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function fmtMonthYear(v) {
    var p = splitDate(v);
    return p ? MONTHS[p[1] - 1] + ' ' + p[0] : '';
  }

  function fmtDayMonthYear(v) {
    var p = splitDate(v);
    return p ? p[2] + ' ' + MONTHS[p[1] - 1] + ' ' + p[0] : '';
  }

  function dateMs(v) {
    if (isNum(v)) return v;
    var p = splitDate(v);
    return p ? Date.UTC(p[0], p[1] - 1, p[2]) : 0;
  }

  function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function encodePath(p) {
    return String(p).split('/').map(encodeURIComponent).join('/');
  }

  function encodeSeg(s) { return encodeURIComponent(String(s)); }

  function clearEl(el) { while (el && el.firstChild) el.removeChild(el.firstChild); }

  function hook(root, name) {
    var el = root ? root.querySelector('[data-slot="' + name + '"]') : null;
    if (!el && root) missingHook(root, 'slot:' + name);
    return el;
  }

  function listHook(root, name) {
    var el = root ? root.querySelector('[data-list="' + name + '"]') : null;
    if (!el && root) missingHook(root, 'list:' + name);
    return el;
  }

  var missing = null;
  function missingHook(root, name) {
    var where = (root.className && typeof root.className === 'string') ? root.className.split(' ')[0] : root.tagName;
    if (!missing) { missing = []; window.PLATZI_MISSING_HOOKS = missing; }
    var id = where + ' → ' + name;
    if (missing.indexOf(id) < 0) missing.push(id);
  }

  function setText(root, name, text) {
    var el = hook(root, name);
    if (el) el.textContent = text == null ? '' : String(text);
    return el;
  }

  function show(el, on) { if (el) el.hidden = !on; }

  function labelTarget(el) {
    if (!el) return null;
    var t = el.querySelector('[data-slot="label"], [data-slot="chip-label"], [data-slot="mark-label"]');
    if (t) return t;
    var spans = el.querySelectorAll('span');
    return spans.length ? spans[spans.length - 1] : null;
  }

  function setLabel(el, text) {
    var t = labelTarget(el);
    if (t) t.textContent = text; else if (el) el.textContent = text;
  }

  function pctText(p) { return Math.round(clamp(p, 0, 100)) + '%'; }

  function shortTitle(t, max) {
    t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    var cut = t.slice(0, max - 1);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.5) cut = cut.slice(0, sp);
    return cut.replace(/[\s,;:.\-–—]+$/, '') + '…';
  }

  function initialOf(title) {
    var t = String(title == null ? '' : title).trim();
    return t ? t.charAt(0).toUpperCase() : '#';
  }

  var collator = null;
  try { collator = new Intl.Collator('es', { sensitivity: 'base' }); } catch (e) { collator = null; }

  function cmpTitle(a, b) {
    a = String(a || ''); b = String(b || '');
    if (collator) return collator.compare(a, b);
    return a.localeCompare(b, 'es');
  }

  /* ---------- estado local (SPEC §3) ---------- */

  var state = {
    v: 1,
    watched: {},
    prefs: { speed: 1, captions: 'off', autoplayNext: true, volume: 1 },
    last: null
  };
  var storageOK = true;
  var noticeDone = false;
  var saveTimer = 0;

  function notice(msg) {
    if (noticeDone) return;
    noticeDone = true;
    var el = document.querySelector('[data-slot="notice"], [data-notice]');
    if (!el) {
      el = document.createElement('p');
      el.setAttribute('data-notice', '');
      if (document.body) document.body.appendChild(el);
    }
    if (el) { el.textContent = msg; el.hidden = false; }
  }

  function probeStorage() {
    try {
      window.localStorage.setItem('platziLocal.probe', '1');
      window.localStorage.removeItem('platziLocal.probe');
      return true;
    } catch (e) { return false; }
  }

  function loadState() {
    var raw = null;
    try { raw = window.localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (!raw) return;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
    if (!parsed || typeof parsed !== 'object') return;
    if (parsed.watched && typeof parsed.watched === 'object') state.watched = parsed.watched;
    var p = (parsed.prefs && typeof parsed.prefs === 'object') ? parsed.prefs : null;
    if (p) {
      if (isNum(p.speed) && p.speed > 0) state.prefs.speed = p.speed;
      if (p.captions === 'off' || LANGS.indexOf(p.captions) >= 0) state.prefs.captions = p.captions;
      if (typeof p.autoplayNext === 'boolean') state.prefs.autoplayNext = p.autoplayNext;
      if (isNum(p.volume) && p.volume >= 0 && p.volume <= 1) state.prefs.volume = p.volume;
    }
    var l = parsed.last;
    if (l && typeof l === 'object' && typeof l.slug === 'string' && typeof l.src === 'string') {
      state.last = { slug: l.slug, src: l.src, at: isNum(l.at) ? l.at : 0 };
    }
  }

  function save(now) {
    if (!storageOK) return;
    if (!now) {
      if (saveTimer) return;
      saveTimer = window.setTimeout(function () { saveTimer = 0; save(true); }, 250);
      return;
    }
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { storageOK = false; notice(MSG_STORAGE); }
  }

  function entryKey(slug, src) { return slug + '|' + src; }

  function getEntry(slug, src) {
    var e = state.watched[entryKey(slug, src)];
    return (e && typeof e === 'object') ? e : null;
  }

  function ensureEntry(slug, src) {
    var k = entryKey(slug, src);
    var e = state.watched[k];
    if (!e || typeof e !== 'object') { e = { done: false, pos: 0, at: 0 }; state.watched[k] = e; }
    return e;
  }

  function markDone(slug, src, val) {
    var e = ensureEntry(slug, src);
    e.done = !!val;
    e.at = Date.now();
    forceProgressSave();
    refreshChip();
  }

  function setPos(slug, src, pos) {
    var e = ensureEntry(slug, src);
    e.pos = (isNum(pos) && pos > 0) ? pos : 0;
    e.at = Date.now();
    state.last = { slug: slug, src: src, at: e.at };
    forceProgressSave();
    refreshChip();
  }

  function forceProgressSave() {
    if (!storageOK) return;
    save();
  }

  /* ---------- índices (se construyen una sola vez) ---------- */

  var bySlug = Object.create(null);
  (function () {
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      if (c && typeof c === 'object' && typeof c.slug === 'string' && !bySlug[c.slug]) bySlug[c.slug] = c;
    }
  })();

  var byRouteId = Object.create(null);
  (function () {
    for (var i = 0; i < routeList.length; i++) {
      var r = routeList[i];
      if (r && typeof r === 'object' && r.id != null && !byRouteId[r.id]) byRouteId[r.id] = r;
    }
  })();

  var flatMap = Object.create(null);

  function flatClasses(course) {
    if (!course || typeof course.slug !== 'string') return [];
    var cached = flatMap[course.slug];
    if (cached) return cached;
    var out = [];
    var mods = Array.isArray(course.modules) ? course.modules : [];
    var n = 0;
    for (var mi = 0; mi < mods.length; mi++) {
      var mod = (mods[mi] && typeof mods[mi] === 'object') ? mods[mi] : {};
      var cls = Array.isArray(mod.classes) ? mod.classes : [];
      for (var ki = 0; ki < cls.length; ki++) {
        var cl = cls[ki];
        if (!cl || typeof cl.src !== 'string' || !cl.src) continue;
        n++;
        out.push({
          n: n,
          src: cl.src,
          title: cl.title == null ? '' : String(cl.title),
          durationSec: isNum(cl.durationSec) ? cl.durationSec : null,
          subs: (cl.subs && typeof cl.subs === 'object') ? cl.subs : null,
          moduleIndex: mi,
          moduleName: mod.name == null ? '' : String(mod.name)
        });
      }
    }
    flatMap[course.slug] = out;
    return out;
  }

  function totalClasses(course) {
    if (course && isNum(course.classesTotal) && course.classesTotal > 0) return course.classesTotal;
    return flatClasses(course).length;
  }

  function doneCount(course) {
    var fl = flatClasses(course);
    var n = 0;
    for (var i = 0; i < fl.length; i++) {
      var e = getEntry(course.slug, fl[i].src);
      if (e && e.done) n++;
    }
    return n;
  }

  function hasLocalActivity(course) {
    var fl = flatClasses(course);
    for (var i = 0; i < fl.length; i++) {
      var e = getEntry(course.slug, fl[i].src);
      if (e && (e.done || e.pos > 0)) return true;
    }
    return false;
  }

  function lastActivityMs(course) {
    var fl = flatClasses(course);
    var max = 0;
    for (var i = 0; i < fl.length; i++) {
      var e = getEntry(course.slug, fl[i].src);
      if (e && isNum(e.at) && e.at > max) max = e.at;
    }
    return max;
  }

  function pctLocal(course) {
    if (!course || !course.downloaded) return 0;
    var total = totalClasses(course);
    if (!total) return 0;
    return clamp(Math.round((doneCount(course) / total) * 100), 0, 100);
  }

  function firstUndoneIndex(course) {
    var fl = flatClasses(course);
    for (var i = 0; i < fl.length; i++) {
      var e = getEntry(course.slug, fl[i].src);
      if (!e || !e.done) return i;
    }
    return -1;
  }

  function lastTouchedIndex(course) {
    var fl = flatClasses(course);
    var best = -1;
    var bestAt = 0;
    for (var i = 0; i < fl.length; i++) {
      var e = getEntry(course.slug, fl[i].src);
      if (e && isNum(e.at) && e.at > bestAt) { bestAt = e.at; best = i; }
    }
    return best;
  }

  function nextTarget(course) {
    var fl = flatClasses(course);
    if (!fl.length) return null;
    var idx = firstUndoneIndex(course);
    if (idx < 0) return { item: fl[0], label: 'Reproducir' };
    var e = getEntry(course.slug, fl[idx].src);
    var label = (e && e.pos > 0) ? 'Reanudar' : (hasLocalActivity(course) ? 'Continuar' : 'Reproducir');
    return { item: fl[idx], label: label };
  }

  /* ---------- meta, chips y portadas ---------- */

  function routePct(r) { return clamp(isNum(r && r.pct) ? r.pct : 0, 0, 100); }

  function routeCount(r) {
    if (isNum(r && r.coursesCount)) return r.coursesCount;
    return Array.isArray(r && r.courses) ? r.courses.length : 0;
  }

  function courseMeta(course) {
    var n = totalClasses(course);
    var sec = (isNum(course.durationSec) && course.durationSec > 0) ? course.durationSec
      : (isNum(course.hours) ? course.hours * 3600 : null);
    var dur = fmtDuration(sec);
    var head = n + (n === 1 ? ' clase' : ' clases');
    return dur ? head + ' · ' + dur : head;
  }

  function routeMeta(r) {
    var n = routeCount(r);
    var h = fmtHours(isNum(r && r.hours) ? r.hours : null);
    return n + (n === 1 ? ' curso' : ' cursos') + (h ? ' · ' + h : '');
  }

  function courseInProgress(course) {
    if (hasLocalActivity(course)) return true;
    var p = course.platzi;
    return !!(p && isNum(p.done) && p.done > 0);
  }

  var CHIP_TEXT = { cert: 'Aprobado', progress: 'En curso', downloaded: 'Descargado', queued: 'En cola', missing: 'Sin descargar' };

  function chipsFor(course) {
    var out = [];
    if (course.cert) out.push('cert');
    if (courseInProgress(course)) out.push('progress');
    if (course.downloaded) out.push('downloaded');
    if (course.queued) out.push('queued');
    if (!course.downloaded) out.push('missing');
    return out;
  }

  function chipNode(kind) {
    var span = document.createElement('span');
    span.className = 'chip chip-' + kind;
    span.textContent = CHIP_TEXT[kind] || '';
    return span;
  }

  function fillChips(container, course) {
    if (!container) return;
    clearEl(container);
    var kinds = chipsFor(course);
    for (var i = 0; i < kinds.length; i++) container.appendChild(chipNode(kinds[i]));
  }

  function courseState(course) {
    if (course.cert) return 'certified';
    if (courseInProgress(course)) return 'progress';
    if (course.queued) return 'queued';
    if (!course.downloaded) return 'missing';
    return 'available';
  }

  function fillCover(view, data) {
    var img = hook(view, 'cover');
    var fb = hook(view, 'cover-fallback');
    var has = !!(data && typeof data.cover === 'string' && data.cover);
    if (img) {
      if (has) {
        img.setAttribute('src', encodePath(data.cover));
        img.setAttribute('alt', '');
        img.onerror = function () {
          img.hidden = true;
          img.removeAttribute('src');
          if (fb) fb.hidden = false;
        };
        img.hidden = false;
      } else {
        img.hidden = true;
        img.removeAttribute('src');
      }
    }
    if (fb) {
      fb.textContent = initialOf(data && data.title);
      fb.hidden = has;
    }
  }

  function progressParts(scope) {
    var bar = hook(scope, 'bar');
    /* el slot progress es opcional (la barra vive dentro de .progressbar); no reportar como faltante */
    var box = scope ? scope.querySelector('[data-slot="progress"]') : null;
    var wrap = null;
    if (bar && bar.parentElement && bar.parentElement.classList && bar.parentElement.classList.contains('progressbar')) {
      wrap = bar.parentElement;
    }
    return { bar: bar, box: box || wrap, wrap: wrap };
  }

  function setProgress(scope, pct, enabled) {
    var p = progressParts(scope);
    if (!enabled) {
      if (p.box) p.box.hidden = true;
      if (p.wrap && p.wrap !== p.box) p.wrap.hidden = true;
      if (p.bar && p.bar !== p.box && p.bar !== p.wrap) p.bar.hidden = true;
      return;
    }
    if (p.box) p.box.hidden = false;
    if (p.wrap) p.wrap.hidden = false;
    if (p.bar) {
      p.bar.hidden = false;
      p.bar.style.width = clamp(pct, 0, 100) + '%';
    }
  }

  /* ---------- parciales ---------- */

  function partial(tplId, fill) {
    var t = document.getElementById(tplId);
    var rootNode = (t && t.content) ? t.content.firstElementChild : null;
    if (!rootNode) return null;
    var node = rootNode.cloneNode(true);
    if (fill) fill(node);
    return node;
  }

  function hrefCurso(slug) { return '#/curso/' + encodeSeg(slug); }
  function hrefRuta(id) { return '#/ruta/' + encodeSeg(id); }
  function hrefAula(slug, n) { return '#/aula/' + encodeSeg(slug) + '/' + n; }

  function fillCourseCard(card, course) {
    if (!card || !course) return;
    card.setAttribute('data-state', courseState(course));
    var link = card.querySelector('a[data-slot="link"]') || hook(card, 'link');
    if (link) link.setAttribute('href', hrefCurso(course.slug));
    fillCover(card, course);
    setText(card, 'title', course.title || course.slug);
    setText(card, 'meta', courseMeta(course));
    fillChips(hook(card, 'status'), course);
    setProgress(card, pctLocal(course), !!course.downloaded);
  }

  function fillRouteCard(card, route) {
    if (!card || !route) return;
    if (card.tagName === 'A') card.setAttribute('href', hrefRuta(route.id));
    fillCover(card, route);
    setText(card, 'title', route.title || route.id);
    setText(card, 'meta', routeMeta(route));
    var pct = routePct(route);
    var bar = hook(card, 'bar');
    if (bar) { bar.hidden = false; bar.style.width = pct + '%'; }
    setText(card, 'pct', pctText(pct));
  }

  function fillClassRow(row, course, item, opts) {
    if (!row || !course || !item) return;
    opts = opts || {};
    var e = getEntry(course.slug, item.src);
    var done = !!(e && e.done);
    var link = row.querySelector('a[data-slot="link"]') || hook(row, 'link');
    if (link) link.setAttribute('href', hrefAula(course.slug, item.n));
    var svg = hook(row, 'icon');
    if (svg) {
      var use = svg.querySelector('use');
      if (use) use.setAttribute('href', done ? '#ic-check' : '#ic-play');
    }
    setText(row, 'title', item.title || 'Clase ' + item.n);
    setText(row, 'time', fmtTime(item.durationSec));
    var fine = done ? 100 : ((item.durationSec && e && isNum(e.pos) && e.pos > 0) ? clamp((e.pos / item.durationSec) * 100, 0, 100) : 0);
    var bar = hook(row, 'bar');
    if (bar) { bar.hidden = false; bar.style.width = fine + '%'; }
    if (done) row.setAttribute('data-done', 'true'); else row.removeAttribute('data-done');
    if (opts.current) {
      row.setAttribute('data-current', 'true');
      if (link) link.setAttribute('aria-current', 'true');
    } else {
      row.removeAttribute('data-current');
      if (link) link.removeAttribute('aria-current');
    }
  }

  function fillResultClass(row, hint) {
    if (!row || !hint) return;
    var link = row.querySelector('a[data-slot="link"]') || hook(row, 'link');
    var isCourse = hint.type === 'course';
    if (link) link.setAttribute('href', isCourse ? hrefCurso(hint.slug) : hrefAula(hint.slug, hint.n));
    setText(row, 'title', hint.title || '');
    setText(row, 'course', isCourse ? 'Curso' : (hint.courseTitle || ''));
    setText(row, 'time', isCourse ? '' : fmtTime(hint.time));
  }

  /* ---------- render de vistas ---------- */

  function mount(tplId, fill) {
    if (!appEl) return null;
    clearEl(appEl);
    var t = document.getElementById(tplId);
    var frag = (t && t.content) ? t.content.cloneNode(true) : null;
    var view = frag ? frag.firstElementChild : null;
    if (frag) appEl.appendChild(frag);
    if (view && fill) fill(view);
    return view;
  }

  function mountMissingData() {
    clearEl(appEl);
    var wrap = document.createElement('section');
    wrap.className = 'view view-sin-datos';
    var h = document.createElement('h1');
    h.textContent = 'Catálogo no generado aún';
    var p = document.createElement('p');
    p.textContent = 'Ejecuta scripts/viewer_data.py para crear viewer/data.js y recarga la página.';
    wrap.appendChild(h);
    wrap.appendChild(p);
    appEl.appendChild(wrap);
  }

  function afterRoute() {
    try { window.scrollTo(0, 0); } catch (e) { /* entornos sin scroll */ }
    if (appEl) {
      try { appEl.focus({ preventScroll: true }); } catch (e) { try { appEl.focus(); } catch (e2) { /* sin foco */ } }
    }
  }

  function setTitle(t) { document.title = t; }

  function renderShell(activeNav) {
    var links = document.querySelectorAll('a[data-nav]');
    for (var i = 0; i < links.length; i++) {
      if (activeNav && links[i].getAttribute('data-nav') === activeNav) links[i].setAttribute('aria-current', 'page');
      else links[i].removeAttribute('aria-current');
    }
    refreshChip();
  }

  var chipTextNode = null;

  function paintChip() {
    if (!chipEl) return;
    var target = resumeTarget();
    show(chipEl, !!target);
    if (!target) return;
    var label = chipTextNode || labelTarget(chipEl);
    if (!label) {
      chipTextNode = document.createTextNode('');
      chipEl.appendChild(chipTextNode);
      label = chipTextNode;
    }
    var text = 'Retomar · ' + shortTitle(target.item.title || 'Clase ' + target.item.n, 42);
    if (label.nodeType === 3) label.nodeValue = text;
    else label.textContent = text;
  }

  function refreshChip() { paintChip(); }

  function resumeTarget() {
    if (!state.last || typeof state.last.slug !== 'string' || typeof state.last.src !== 'string') return null;
    var course = bySlug[state.last.slug];
    if (!course) return null;
    var fl = flatClasses(course);
    if (!fl.length) return null;
    for (var i = 0; i < fl.length; i++) {
      if (fl[i].src === state.last.src) return { course: course, item: fl[i] };
    }
    var idx = firstUndoneIndex(course);
    if (idx < 0) idx = 0;
    return { course: course, item: fl[idx] };
  }

  function groupAncestor(view, els, stopEl) {
    var first = null;
    for (var i = 0; i < els.length; i++) { if (els[i]) { first = els[i]; break; } }
    if (!first) return null;
    var candidate = null;
    var node = first.parentElement;
    while (node && node !== view) {
      var all = true;
      for (var j = 0; j < els.length; j++) { if (els[j] && !node.contains(els[j])) { all = false; break; } }
      if (!all) break;
      if (stopEl && node.contains(stopEl)) break;
      var foreign = node.querySelectorAll('[data-slot], [data-list]');
      var clean = true;
      for (var k = 0; k < foreign.length; k++) {
        if (els.indexOf(foreign[k]) < 0) { clean = false; break; }
      }
      if (!clean) break;
      candidate = node;
      node = node.parentElement;
    }
    return candidate;
  }

  /* ---------- inicio ---------- */

  function homeRoutes() {
    var sorted = routeList.slice().sort(function (a, b) {
      var d = routePct(b) - routePct(a);
      return d || cmpTitle(a.title || a.id, b.title || b.id);
    });
    var out = sorted.filter(function (r) { var p = routePct(r); return p > 0 && p < 100; });
    if (out.length < 4) {
      for (var i = 0; i < sorted.length && out.length < 6; i++) {
        if (out.indexOf(sorted[i]) < 0) out.push(sorted[i]);
      }
    }
    return out.slice(0, 6);
  }

  function homeCourses() {
    var scored = [];
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      var ms = Math.max(lastActivityMs(c), dateMs(c.platzi && c.platzi.at));
      if (ms > 0) scored.push({ course: c, ms: ms });
    }
    scored.sort(function (a, b) { return (b.ms - a.ms) || cmpTitle(a.course.title || '', b.course.title || ''); });
    var out = [], seen = Object.create(null);
    for (var s = 0; s < scored.length && out.length < 12; s++) {
      out.push(scored[s].course);
      seen[scored[s].course.slug] = true;
    }
    if (out.length < 12) {
      var dl = courses.filter(function (c) { return c.downloaded && !seen[c.slug]; });
      dl.sort(function (a, b) { return cmpTitle(a.title || '', b.title || ''); });
      for (var d = 0; d < dl.length && out.length < 12; d++) {
        out.push(dl[d]);
        seen[dl[d].slug] = true;
      }
    }
    if (!out.length) {
      var alpha = courses.slice().sort(function (a, b) { return cmpTitle(a.title || a.slug, b.title || b.slug); });
      out = alpha.slice(0, 12);
    }
    return out;
  }

  function fillHome(view) {
    var allRoutes = hook(view, 'all-routes');
    if (allRoutes) allRoutes.setAttribute('href', '#/rutas');
    var allCourses = hook(view, 'all-courses');
    if (allCourses) allCourses.setAttribute('href', '#/cursos');

    var target = resumeTarget();
    var empty = hook(view, 'resume-empty');
    var title = hook(view, 'resume-title');
    var meta = hook(view, 'resume-meta');
    var link = view.querySelector('a[data-slot="resume-link"]');
    if (target) {
      if (empty) empty.hidden = true;
      show(title, true);
      show(meta, true);
      show(link, true);
      setText(view, 'resume-title', target.item.title || ('Clase ' + target.item.n));
      var courseName = target.course.title || target.course.slug;
      setText(view, 'resume-meta', target.item.moduleName ? courseName + ' · ' + target.item.moduleName : courseName);
      if (link) link.setAttribute('href', hrefAula(target.course.slug, target.item.n));
    } else {
      show(title, false); show(meta, false); show(link, false);
      if (empty) {
        empty.hidden = false;
        var cta = empty.querySelector('a, button');
        if (cta && cta.tagName === 'A') cta.setAttribute('href', '#/rutas');
      }
    }

    var routeBox = listHook(view, 'routes');
    if (routeBox) {
      clearEl(routeBox);
      var rs = homeRoutes();
      for (var i = 0; i < rs.length; i++) {
        var rc = partial('tpl-route-card', (function (r) { return function (n) { fillRouteCard(n, r); }; })(rs[i]));
        if (rc) routeBox.appendChild(rc);
      }
    }

    var courseBox = listHook(view, 'courses');
    if (courseBox) {
      clearEl(courseBox);
      var cs = homeCourses();
      for (var j = 0; j < cs.length; j++) {
        var cc = partial('tpl-course-card', (function (c) { return function (n) { fillCourseCard(n, c); }; })(cs[j]));
        if (cc) courseBox.appendChild(cc);
      }
    }
  }

  function renderHome() {
    setTitle('Inicio · Platzi Local');
    renderShell('inicio');
    mount('tpl-home', fillHome);
    afterRoute();
  }

  /* ---------- rutas ---------- */

  function sortedRoutes() {
    return routeList.slice().sort(function (a, b) {
      var d = routePct(b) - routePct(a);
      return d || cmpTitle(a.title || a.id, b.title || b.id);
    });
  }

  function fillRoutes(view) {
    var box = listHook(view, 'routes');
    var rs = sortedRoutes();
    if (box) {
      clearEl(box);
      for (var i = 0; i < rs.length; i++) {
        var card = partial('tpl-route-card', (function (r) { return function (n) { fillRouteCard(n, r); }; })(rs[i]));
        if (card) box.appendChild(card);
      }
    }
    show(hook(view, 'empty'), rs.length === 0);
  }

  function renderRutas() {
    setTitle('Rutas · Platzi Local');
    renderShell('rutas');
    mount('tpl-rutas', fillRoutes);
    afterRoute();
  }

  function routeContinue(route) {
    var ids = Array.isArray(route.courses) ? route.courses : [];
    var best = null;
    var bestMs = -1;
    for (var i = 0; i < ids.length; i++) {
      var c = bySlug[ids[i]];
      if (!c || !c.downloaded) continue;
      var ms = lastActivityMs(c);
      if (ms > bestMs) { bestMs = ms; best = c; }
    }
    if (!best) return null;
    var t = nextTarget(best);
    return t ? { course: best, item: t.item } : null;
  }

  function fillRuta(view, route) {
    setText(view, 'title', route.title || route.id);
    fillCover(view, route);
    setText(view, 'meta', routeMeta(route));
    var pct = routePct(route);
    var bar = hook(view, 'bar');
    if (bar) { bar.hidden = false; bar.style.width = pct + '%'; }
    setText(view, 'pct', pctText(pct));

    var ids = Array.isArray(route.courses) ? route.courses : [];
    var box = listHook(view, 'courses');
    var count = 0;
    if (box) {
      clearEl(box);
      for (var i = 0; i < ids.length; i++) {
        var c = bySlug[ids[i]];
        if (!c) continue;
        count++;
        var card = partial('tpl-course-card', (function (cc) { return function (n) { fillCourseCard(n, cc); }; })(c));
        if (card) box.appendChild(card);
      }
    }
    show(hook(view, 'empty'), count === 0);

    var cont = view.querySelector('a[data-slot="continue"]');
    var target = routeContinue(route);
    if (cont) {
      if (target) {
        cont.hidden = false;
        cont.setAttribute('href', hrefAula(target.course.slug, target.item.n));
      } else {
        cont.hidden = true;
      }
    }
  }

  function renderRuta(route) {
    setTitle((route.title || route.id || 'Ruta') + ' · Platzi Local');
    renderShell('rutas');
    mount('tpl-ruta', function (view) { fillRuta(view, route); });
    afterRoute();
  }

  /* ---------- catálogo ---------- */

  var cursoFilter = 'all';

  function sortedCatalog() {
    return courses.slice().sort(function (a, b) {
      var ca = a.cert ? 1 : 0;
      var cb = b.cert ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return cmpTitle(a.title || a.slug, b.title || b.slug);
    });
  }

  function courseMatches(course, filter) {
    if (filter === 'progress') return courseInProgress(course) && !course.cert;
    if (filter === 'cert') return !!course.cert;
    if (filter === 'downloaded') return !!course.downloaded;
    if (filter === 'queued') return !!course.queued;
    if (filter === 'missing') return !course.downloaded;
    return true;
  }

  function updateCursosList(view) {
    var box = listHook(view, 'courses');
    var filtered = sortedCatalog().filter(function (c) { return courseMatches(c, cursoFilter); });
    if (box) {
      clearEl(box);
      for (var i = 0; i < filtered.length; i++) {
        var card = partial('tpl-course-card', (function (c) { return function (n) { fillCourseCard(n, c); }; })(filtered[i]));
        if (card) box.appendChild(card);
      }
    }
    setText(view, 'count', filtered.length + (filtered.length === 1 ? ' curso' : ' cursos'));
    var emptyEl = hook(view, 'empty');
    if (emptyEl) {
      var msg = courses.length === 0 ? 'Todavía no hay cursos en el catálogo' : 'Ningún curso coincide con este filtro';
      if (emptyEl.textContent !== msg) emptyEl.textContent = msg;
      emptyEl.hidden = filtered.length !== 0;
    }
    var btns = view.querySelectorAll('[data-filter]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].setAttribute('aria-pressed', btns[b].getAttribute('data-filter') === cursoFilter ? 'true' : 'false');
    }
  }

  function renderCursos() {
    setTitle('Mis cursos · Platzi Local');
    renderShell('cursos');
    mount('tpl-cursos', function (view) {
      var btns = view.querySelectorAll('[data-filter]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          cursoFilter = this.getAttribute('data-filter') || 'all';
          updateCursosList(view);
        });
      }
      updateCursosList(view);
    });
    afterRoute();
  }

  /* ---------- curso ---------- */

  function courseCurrentIndex(course) {
    var fl = flatClasses(course);
    if (!fl.length) return -1;
    if (state.last && state.last.slug === course.slug) {
      for (var i = 0; i < fl.length; i++) {
        if (fl[i].src === state.last.src) return i;
      }
    }
    return lastTouchedIndex(course);
  }

  function platziLine(course) {
    var parts = [];
    var p = course.platzi;
    if (p && (isNum(p.done) || isNum(p.total))) {
      var head = 'En Platzi: ' + (isNum(p.done) ? p.done : '?') + '/' + (isNum(p.total) ? p.total : '?');
      var at = fmtMonthYear(p.at);
      parts.push(at ? head + ' · ' + at : head);
    }
    if (course.cert) {
      var d = fmtDayMonthYear(course.cert.date);
      if (d) parts.push('Aprobado el ' + d);
    }
    return parts.join(' · ');
  }

  function moduleNode(course, mod, modIndex, currentN, forceOpen) {
    var node = partial('tpl-module', null);
    if (!node) return null;
    if (node.tagName === 'DETAILS') node.open = !!forceOpen;
    setText(node, 'name', (mod && mod.name != null) ? String(mod.name) : '');
    var fl = flatClasses(course);
    var items = [];
    for (var i = 0; i < fl.length; i++) {
      if (fl[i].moduleIndex === modIndex) items.push(fl[i]);
    }
    setText(node, 'count', items.length + (items.length === 1 ? ' clase' : ' clases'));
    var box = listHook(node, 'classes');
    if (box) {
      clearEl(box);
      for (var j = 0; j < items.length; j++) {
        var row = partial('tpl-class-row', (function (it) {
          return function (n) { fillClassRow(n, course, it, { current: it.n === currentN }); };
        })(items[j]));
        if (row) box.appendChild(row);
      }
    }
    return node;
  }

  function fillCurso(view, course) {
    setText(view, 'title', course.title || course.slug);
    fillCover(view, course);
    fillChips(hook(view, 'chips'), course);

    var downloaded = !!course.downloaded;
    var total = totalClasses(course);
    var done = doneCount(course);
    var ptext = hook(view, 'progress-text');
    if (ptext) {
      ptext.textContent = downloaded ? (done + '/' + total + ' vistas') : '';
      ptext.hidden = !downloaded;
    }
    setProgress(view, pctLocal(course), downloaded);

    var line = platziLine(course);
    var platziEl = hook(view, 'platzi');
    if (platziEl) { platziEl.textContent = line; platziEl.hidden = !line; }

    var diploma = view.querySelector('a[data-slot="diploma"]');
    if (diploma) {
      var url = (course.cert && typeof course.cert.url === 'string') ? course.cert.url : '';
      if (url) {
        diploma.hidden = false;
        diploma.setAttribute('href', url);
        diploma.setAttribute('target', '_blank');
        diploma.setAttribute('rel', 'noopener noreferrer');
      } else {
        diploma.hidden = true;
        diploma.removeAttribute('href');
      }
    }

    var cont = view.querySelector('a[data-slot="continue"]');
    var label = hook(view, 'continue-label');
    var target = nextTarget(course);
    if (cont) {
      if (downloaded && target) {
        cont.hidden = false;
        cont.removeAttribute('aria-disabled');
        cont.removeAttribute('disabled');
        cont.setAttribute('href', hrefAula(course.slug, target.item.n));
        if (label) label.textContent = target.label;
      } else {
        cont.hidden = false;
        cont.removeAttribute('href');
        cont.setAttribute('aria-disabled', 'true');
        cont.setAttribute('disabled', '');
        if (label) label.textContent = 'Continuar';
      }
    }

    var mods = Array.isArray(course.modules) ? course.modules : [];
    var current = courseCurrentIndex(course);
    var fl = flatClasses(course);
    var currentN = current >= 0 ? fl[current].n : -1;
    var currentModule = current >= 0 ? fl[current].moduleIndex : 0;
    var box = listHook(view, 'modules');
    if (box) {
      clearEl(box);
      box.hidden = !downloaded;
      for (var mi = 0; mi < mods.length; mi++) {
        var node = moduleNode(course, mods[mi], mi, currentN, mods.length <= 3 || mi === currentModule);
        if (node) box.appendChild(node);
      }
    }
    show(hook(view, 'empty'), !downloaded);
  }

  function renderCurso(course) {
    setTitle((course.title || course.slug) + ' · Platzi Local');
    renderShell('cursos');
    mount('tpl-curso', function (view) { fillCurso(view, course); });
    afterRoute();
  }

  /* ---------- aula ---------- */

  var aula = null;

  function gotoHash(hash) {
    if (!hash || window.location.hash === hash) return;
    window.location.hash = hash;
  }

  function redirectTo(hash) {
    if (window.location.hash === hash) { renderRoute(); return; }
    try { window.location.replace(hash); } catch (e) { window.location.hash = hash; }
  }

  function aulaValidSpeed(v) {
    for (var i = 0; i < SPEEDS.length; i++) {
      if (Math.abs(SPEEDS[i] - v) < 0.001) return SPEEDS[i];
    }
    return 1;
  }

  function applyCaptions(lang, video, view, persist) {
    if (lang !== 'off' && LANGS.indexOf(lang) < 0) lang = 'off';
    if (persist) { state.prefs.captions = lang; save(); }
    if (video && video.textTracks) {
      for (var i = 0; i < video.textTracks.length; i++) {
        var tr = video.textTracks[i];
        var code = tr.language || '';
        try { tr.mode = (lang !== 'off' && code === lang) ? 'showing' : 'disabled'; }
        catch (e) { /* pista sin cargar */ }
      }
    }
    if (view) {
      var sel = view.querySelector('select[data-control="captions"]');
      if (sel && sel.value !== lang) sel.value = lang;
    }
  }

  function saveAulaTick(video) {
    var a = aula;
    if (!a || a.video !== video) return;
    var t = video.currentTime;
    if (!isNum(t) || t <= 0) return;
    if (Math.abs(t - a.savedAt) >= 5) {
      a.savedAt = t;
      setPos(a.slug, a.src, t);
    }
  }

  function saveAulaNow(video) {
    var a = aula;
    if (!a || a.video !== video) return;
    var t = NaN;
    try { t = video.currentTime; } catch (e) { t = NaN; }
    if (isNum(t) && t > 0) {
      a.savedAt = t;
      setPos(a.slug, a.src, t);
    }
  }

  function teardownAula() {
    if (!aula) return;
    var a = aula;
    aula = null;
    if (a.video && !a.error) {
      var t = NaN;
      try { t = a.video.currentTime; } catch (e) { t = NaN; }
      if (isNum(t) && t > 0) setPos(a.slug, a.src, t);
    }
  }

  function aulaVideoError() {
    var a = aula;
    if (!a) return;
    a.error = true;
    if (a.errorEl) {
      if (!a.errorEl.firstElementChild && !a.errorEl.textContent.trim()) a.errorEl.textContent = MSG_VIDEO;
      a.errorEl.hidden = false;
    }
    if (a.autoplayEl) {
      a.autoplayEl.checked = false;
      a.autoplayEl.disabled = true;
    }
  }

  function refreshAulaMarks() {
    var a = aula;
    if (!a) return;
    var total = totalClasses(a.course);
    var done = doneCount(a.course);
    var ptext = hook(a.view, 'progress-text');
    if (ptext) ptext.textContent = done + '/' + total + ' vistas';
    if (a.rowEl) fillClassRow(a.rowEl, a.course, a.item, { current: true });
  }

  function aulaEnded() {
    var a = aula;
    if (!a || a.error) return;
    if (!a.unmarked) {
      markDone(a.slug, a.src, true);
      var e = getEntry(a.slug, a.src);
      var dur = a.video ? a.video.duration : NaN;
      if (e && isNum(dur) && isFinite(dur) && dur > 0) {
        e.pos = dur;
        forceProgressSave();
      }
      refreshAulaMarks();
    }
    if (state.prefs.autoplayNext && a.n < a.max) gotoHash(hrefAula(a.slug, a.n + 1));
  }

  function aulaGo(delta) {
    var a = aula;
    if (!a) return;
    var target = a.n + delta;
    if (target < 1 || target > a.max) return;
    gotoHash(hrefAula(a.slug, target));
  }

  function aulaToggle() {
    var a = aula;
    if (!a || !a.video) return;
    if (a.video.paused) {
      var pr = a.video.play();
      if (pr && pr.catch) pr.catch(function () { /* autoplay bloqueado */ });
    } else {
      a.video.pause();
    }
  }

  function aulaSeek(delta) {
    var a = aula;
    if (!a || !a.video) return;
    var v = a.video;
    var t = isNum(v.currentTime) ? v.currentTime : 0;
    var dur = v.duration;
    var max = (isNum(dur) && isFinite(dur) && dur > 0) ? dur : Infinity;
    var next = t + delta;
    if (next < 0) next = 0;
    if (next > max) next = max;
    try { v.currentTime = next; } catch (e) { /* seek fuera de rango */ }
  }

  function aulaVolume(delta) {
    var a = aula;
    if (!a || !a.video) return;
    a.video.volume = clamp01(a.video.volume + delta);
  }

  function aulaFullscreen() {
    var a = aula;
    if (!a || !a.video) return;
    try {
      if (document.fullscreenElement) {
        var q1 = document.exitFullscreen();
        if (q1 && q1.catch) q1.catch(function () {});
      } else if (a.video.requestFullscreen) {
        var q2 = a.video.requestFullscreen();
        if (q2 && q2.catch) q2.catch(function () {});
      }
    } catch (e) { /* fullscreen no disponible */ }
  }

  function aulaCycleCaptions() {
    var a = aula;
    if (!a) return;
    var seq = ['off'].concat(a.subLangs || []);
    var i = seq.indexOf(state.prefs.captions);
    var nxt = seq[(i + 1) % seq.length];
    applyCaptions(nxt, a.video, a.view, true);
  }

  function buildAula(view, course, n, item, fl) {
    var video = view.querySelector('video#player') || view.querySelector('video');
    var prevBtn = view.querySelector('[data-control="prev"]');
    var nextBtn = view.querySelector('[data-control="next"]');
    var markBtn = view.querySelector('[data-control="mark"]');
    var speedSel = view.querySelector('select[data-control="speed"]');
    var capsSel = view.querySelector('select[data-control="captions"]');
    var autoplay = view.querySelector('input[data-control="autoplay"]');
    var errorEl = hook(view, 'error');

    aula = {
      slug: course.slug, src: item.src, n: n, max: fl.length,
      course: course, item: item, view: view, video: video,
      unmarked: false, savedAt: 0, error: false,
      errorEl: errorEl, autoplayEl: autoplay, rowEl: null, subLangs: []
    };

    setText(view, 'class-title', item.title || ('Clase ' + n));
    setText(view, 'module-name', item.moduleName || '');
    var courseLink = view.querySelector('a[data-slot="course-link"]');
    if (courseLink) {
      courseLink.setAttribute('href', hrefCurso(course.slug));
      if (!courseLink.firstElementChild) courseLink.textContent = course.title || course.slug;
    }
    var ptext = hook(view, 'progress-text');
    if (ptext) ptext.textContent = doneCount(course) + '/' + totalClasses(course) + ' vistas';

    function paintMark() {
      var e = getEntry(course.slug, item.src);
      var done = !!(e && e.done);
      var text = done ? 'Visto ✓' : 'Marcar como visto'; // taste-skill-ignore: copia congelada en SPEC 7.1
      var labelEl = hook(view, 'mark-label');
      if (labelEl) labelEl.textContent = text;
      else setLabel(markBtn, text);
      if (markBtn) markBtn.setAttribute('aria-pressed', done ? 'true' : 'false');
    }

    if (prevBtn) {
      prevBtn.disabled = n <= 1;
      prevBtn.addEventListener('click', function () { aulaGo(-1); });
    }
    if (nextBtn) {
      nextBtn.disabled = n >= fl.length;
      nextBtn.addEventListener('click', function () { aulaGo(1); });
    }
    if (markBtn) {
      markBtn.addEventListener('click', function () {
        var e = getEntry(course.slug, item.src);
        var to = !(e && e.done);
        if (aula) aula.unmarked = !to;
        markDone(course.slug, item.src, to);
        paintMark();
        refreshAulaMarks();
      });
    }
    paintMark();

    var speed = aulaValidSpeed(state.prefs.speed);
    if (speed !== state.prefs.speed) { state.prefs.speed = speed; save(); }
    if (speedSel) {
      speedSel.value = String(speed);
      speedSel.addEventListener('change', function () {
        var v = parseFloat(speedSel.value);
        if (!isNum(v) || v <= 0) v = 1;
        state.prefs.speed = v;
        if (video) video.playbackRate = v;
        save();
      });
    }
    if (capsSel) {
      capsSel.value = state.prefs.captions;
      capsSel.addEventListener('change', function () {
        applyCaptions(capsSel.value, video, view, true);
      });
    }
    if (autoplay) {
      autoplay.checked = !!state.prefs.autoplayNext;
      autoplay.addEventListener('change', function () {
        state.prefs.autoplayNext = !!autoplay.checked;
        save();
      });
    }

    if (video) {
      clearEl(video);
      var srcEl = document.createElement('source');
      srcEl.setAttribute('src', encodePath(item.src));
      srcEl.setAttribute('type', 'video/mp4');
      srcEl.addEventListener('error', aulaVideoError);
      video.appendChild(srcEl);

      var subs = item.subs || {};
      for (var li = 0; li < LANGS.length; li++) {
        var code = LANGS[li];
        var sub = subs[code];
        if (typeof sub !== 'string' || !sub) continue;
        var tr = document.createElement('track');
        tr.setAttribute('kind', 'subtitles');
        tr.setAttribute('srclang', code);
        tr.setAttribute('label', TRACK_LABEL[code]);
        tr.setAttribute('src', encodePath(sub));
        video.appendChild(tr);
        aula.subLangs.push(code);
      }

      video.playbackRate = speed;
      video.volume = clamp01(state.prefs.volume);
      applyCaptions(state.prefs.captions, video, view, false);

      video.addEventListener('loadedmetadata', function () {
        /* Chrome auto-activa una pista al cargar metadatos: reaplicar preferencia */
        applyCaptions(state.prefs.captions, video, view, false);
        var e = getEntry(course.slug, item.src);
        var pos = (e && isNum(e.pos)) ? e.pos : 0;
        var dur = video.duration;
        if (pos > 5 && isNum(dur) && isFinite(dur) && pos < dur - 10) {
          try { video.currentTime = pos; } catch (err) { /* seek fuera de rango */ }
        }
      });
      video.addEventListener('timeupdate', function () { saveAulaTick(video); });
      video.addEventListener('pause', function () { saveAulaNow(video); });
      video.addEventListener('ended', aulaEnded);
      video.addEventListener('error', aulaVideoError);
      video.addEventListener('volumechange', function () {
        state.prefs.volume = clamp01(video.volume);
        save();
      });
      video.load();
    } else {
      aulaVideoError();
    }

    var box = listHook(view, 'classes');
    if (box) {
      clearEl(box);
      var currentRow = null;
      for (var i = 0; i < fl.length; i++) {
        var row = partial('tpl-class-row', (function (it) {
          return function (node) { fillClassRow(node, course, it, { current: it.n === n }); };
        })(fl[i]));
        if (!row) continue;
        if (fl[i].n === n) currentRow = row;
        box.appendChild(row);
      }
      if (currentRow && aula) {
        aula.rowEl = currentRow;
        revealRow(currentRow);
      }
    }
  }

  function revealRow(row) {
    function run() {
      var box = scrollBoxOf(row);
      if (!box) return;
      var r = row.getBoundingClientRect();
      var c = box.getBoundingClientRect();
      if (r.top >= c.top && r.bottom <= c.bottom) return;
      box.scrollTop += (r.top - c.top) - (c.height - r.height) / 2;
    }
    try { window.requestAnimationFrame(run); } catch (e) { run(); }
  }

  function scrollBoxOf(el) {
    var node = el && el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var st = null;
      try { st = window.getComputedStyle(node); } catch (e) { st = null; }
      if (st && (st.overflowY === 'auto' || st.overflowY === 'scroll' || st.overflowY === 'overlay')) {
        if (node.scrollHeight > node.clientHeight + 4) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function renderAula(course, nRaw) {
    var fl = flatClasses(course);
    if (!fl.length) { redirectTo(hrefCurso(course.slug)); return; }
    var n = clamp(isNum(nRaw) ? nRaw : 1, 1, fl.length);
    var item = fl[n - 1];
    setTitle((item.title || 'Clase') + ' · ' + (course.title || course.slug) + ' · Platzi Local');
    renderShell('cursos');
    var view = mount('tpl-aula', function (v) { buildAula(v, course, n, item, fl); });
    if (!view) { aula = null; redirectTo(hrefCurso(course.slug)); return; }
    afterRoute();
  }

  /* ---------- búsqueda ---------- */

  var searchIndex = null;

  function buildIndex() {
    if (searchIndex) return searchIndex;
    searchIndex = [];
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      searchIndex.push({ type: 'course', norm: norm(c.title), title: c.title || c.slug, slug: c.slug, n: 0, courseTitle: '', time: null });
      var fl = flatClasses(c);
      for (var j = 0; j < fl.length; j++) {
        searchIndex.push({ type: 'class', norm: norm(fl[j].title), title: fl[j].title, slug: c.slug, n: fl[j].n, courseTitle: c.title || c.slug, time: fl[j].durationSec });
      }
    }
    return searchIndex;
  }

  function searchHits(q) {
    var out = { courses: [], classes: [] };
    var nq = norm(q).trim();
    if (!nq) return out;
    var idx = buildIndex();
    for (var i = 0; i < idx.length; i++) {
      var it = idx[i];
      var at = it.norm.indexOf(nq);
      if (at < 0) continue;
      var hit = { it: it, at: at, len: it.norm.length };
      if (it.type === 'course') out.courses.push(hit); else out.classes.push(hit);
    }
    function cmp(a, b) { return a.at - b.at || a.len - b.len || cmpTitle(a.it.title, b.it.title); }
    out.courses.sort(cmp);
    out.classes.sort(cmp);
    return out;
  }

  function searchSuggest(q) {
    var res = searchHits(q);
    var all = [];
    for (var i = 0; i < res.courses.length; i++) all.push({ kind: 'course', hit: res.courses[i] });
    for (var j = 0; j < res.classes.length; j++) all.push({ kind: 'class', hit: res.classes[j] });
    all.sort(function (a, b) {
      var d = (a.hit.at - b.hit.at) || (a.hit.len - b.hit.len);
      if (d) return d;
      if (a.kind !== b.kind) return a.kind === 'course' ? -1 : 1;
      return cmpTitle(a.hit.it.title, b.hit.it.title);
    });
    var out = [], nc = 0, nk = 0;
    for (var k = 0; k < all.length && out.length < 8; k++) {
      if (all[k].kind === 'course') { if (nc++ >= 5) continue; }
      else if (nk++ >= 5) continue;
      out.push(all[k]);
    }
    return out;
  }

  var suggestItems = [];
  var suggestActive = -1;

  function closeSuggest() {
    if (searchBox) { searchBox.hidden = true; clearEl(searchBox); }
    if (searchInput) {
      searchInput.setAttribute('aria-expanded', 'false');
      searchInput.removeAttribute('aria-activedescendant');
    }
    suggestItems = [];
    suggestActive = -1;
  }

  function setSuggestActive(i) {
    if (!suggestItems.length) return;
    if (i < 0) i = 0;
    if (i > suggestItems.length - 1) i = suggestItems.length - 1;
    for (var k = 0; k < suggestItems.length; k++) {
      if (k === i) {
        suggestItems[k].setAttribute('data-active', 'true');
        suggestItems[k].setAttribute('aria-selected', 'true');
      } else {
        suggestItems[k].removeAttribute('data-active');
        suggestItems[k].setAttribute('aria-selected', 'false');
      }
    }
    suggestActive = i;
    if (searchInput) searchInput.setAttribute('aria-activedescendant', suggestItems[i].id);
  }

  function openSuggest(hints) {
    if (!searchBox) return;
    clearEl(searchBox);
    suggestItems = [];
    suggestActive = -1;
    for (var i = 0; i < hints.length; i++) {
      var hint = hints[i].hit.it;
      var node = partial('tpl-result-class', (function (h) {
        return function (n) { fillResultClass(n, h); };
      })(hint));
      if (!node) continue;
      node.id = 'sr-' + suggestItems.length;
      node.setAttribute('role', 'option');
      node.setAttribute('aria-selected', 'false');
      node.setAttribute('data-kind', hints[i].kind);
      searchBox.appendChild(node);
      suggestItems.push(node);
    }
    if (searchInput) searchInput.setAttribute('aria-expanded', suggestItems.length ? 'true' : 'false');
    searchBox.hidden = suggestItems.length === 0;
  }

  function submitSearch() {
    var q = searchInput ? searchInput.value.trim() : '';
    if (!q) return;
    closeSuggest();
    gotoHash('#/buscar/' + encodeURIComponent(q));
  }

  function initSearch() {
    if (!searchInput) return;
    searchInput.setAttribute('role', 'combobox');
    searchInput.setAttribute('aria-autocomplete', 'list');
    searchInput.setAttribute('aria-expanded', 'false');
    if (searchBox) {
      if (!searchBox.id) searchBox.id = 'search-results';
      searchInput.setAttribute('aria-controls', searchBox.id);
      searchBox.setAttribute('role', 'listbox');
    }
    searchInput.addEventListener('input', function () {
      var q = searchInput.value;
      if (!q.trim()) { closeSuggest(); return; }
      var hints = searchSuggest(q);
      if (!hints.length) { closeSuggest(); return; }
      openSuggest(hints);
    });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && suggestItems.length) {
        e.preventDefault();
        setSuggestActive(suggestActive + 1);
      } else if (e.key === 'ArrowUp' && suggestItems.length) {
        e.preventDefault();
        setSuggestActive(suggestActive <= 0 ? 0 : suggestActive - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (suggestActive >= 0 && suggestItems[suggestActive]) {
          var a = suggestItems[suggestActive].querySelector('a');
          var href = a ? a.getAttribute('href') : null;
          closeSuggest();
          gotoHash(href);
        } else {
          submitSearch();
        }
      } else if (e.key === 'Escape') {
        if (searchBox && !searchBox.hidden) { e.preventDefault(); closeSuggest(); }
        else if (searchInput.value) { searchInput.value = ''; closeSuggest(); }
      }
    });
    if (searchInput.form) {
      searchInput.form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitSearch();
      });
    }
    document.addEventListener('mousedown', function (e) {
      if (!searchBox || searchBox.hidden) return;
      var t = e.target;
      if (t && searchWrap && searchWrap.contains(t)) return;
      if (t && searchBox.contains(t)) return;
      closeSuggest();
    });
  }

  function renderBuscar(q) {
    setTitle('Buscar «' + q + '» · Platzi Local');
    renderShell(null);
    mount('tpl-buscar', function (view) {
      setText(view, 'q', q);
      var res = searchHits(q);

      var cBox = listHook(view, 'courses');
      if (cBox) {
        clearEl(cBox);
        for (var i = 0; i < res.courses.length; i++) {
          var c = bySlug[res.courses[i].it.slug];
          if (!c) continue;
          var card = partial('tpl-course-card', (function (cc) {
            return function (n) { fillCourseCard(n, cc); };
          })(c));
          if (card) cBox.appendChild(card);
        }
        cBox.hidden = cBox.childNodes.length === 0;
      }

      var kBox = listHook(view, 'classes');
      if (kBox) {
        clearEl(kBox);
        var classes = res.classes.slice(0, 100);
        for (var j = 0; j < classes.length; j++) {
          var row = partial('tpl-result-class', (function (h) {
            return function (n) { fillResultClass(n, h); };
          })(classes[j].it));
          if (row) kBox.appendChild(row);
        }
        kBox.hidden = classes.length === 0;
      }

      var emptyEl = hook(view, 'empty');
      if (emptyEl) {
        var none = res.courses.length === 0 && res.classes.length === 0;
        if (none && !emptyEl.firstElementChild) emptyEl.textContent = 'Sin resultados para «' + q + '»';
        emptyEl.hidden = !none;
      }
    });
    afterRoute();
  }

  /* ---------- router ---------- */

  function currentPath() {
    var h = window.location.hash || '';
    if (h.charAt(0) === '#') h = h.slice(1);
    return h;
  }

  function decodeSeg(s) {
    try { return decodeURIComponent(s); } catch (e) { return null; }
  }

  function renderRoute() {
    teardownAula();
    closeSuggest();
    if (!DATA || !Array.isArray(DATA.courses)) {
      setTitle('Platzi Local');
      renderShell(null);
      mountMissingData();
      afterRoute();
      return;
    }
    var path = currentPath();
    if (path === '') path = '/';
    if (path.charAt(0) !== '/') { redirectTo('#/'); return; }
    var parts = path.split('/');
    parts.shift();
    var seg = parts[0] || '';

    if (seg === '') { renderHome(); return; }
    if (seg === 'rutas') { renderRutas(); return; }
    if (seg === 'cursos') { renderCursos(); return; }
    if (seg === 'ruta') {
      var rid = decodeSeg(parts[1] || '');
      var route = rid ? byRouteId[rid] : null;
      if (!route) { redirectTo('#/'); return; }
      renderRuta(route);
      return;
    }
    if (seg === 'curso') {
      var cslug = decodeSeg(parts[1] || '');
      var course = cslug ? bySlug[cslug] : null;
      if (!course) { redirectTo('#/'); return; }
      renderCurso(course);
      return;
    }
    if (seg === 'aula') {
      var aslug = decodeSeg(parts[1] || '');
      var acourse = aslug ? bySlug[aslug] : null;
      if (!acourse) { redirectTo('#/'); return; }
      var an = parseInt(parts[2], 10);
      renderAula(acourse, isFinite(an) ? an : 1);
      return;
    }
    if (seg === 'buscar') {
      var q = decodeSeg(parts.slice(1).join('/') || '');
      if (!q) { redirectTo('#/'); return; }
      renderBuscar(q);
      return;
    }
    redirectTo('#/');
  }

  /* ---------- teclado del aula ---------- */

  function isTyping(el) {
    if (!el || !el.tagName) return false;
    var t = el.tagName.toLowerCase();
    return t === 'input' || t === 'select' || t === 'textarea' || el.isContentEditable === true;
  }

  function onKeyDown(e) {
    if (!aula || !aula.video || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    var k = e.key;
    if ((tag === 'button' || tag === 'a') && k === ' ') return;
    var handled = true;
    switch (k) {
      case ' ': case 'k': case 'K': aulaToggle(); break;
      case 'ArrowLeft': aulaSeek(-5); break;
      case 'ArrowRight': aulaSeek(5); break;
      case 'j': case 'J': aulaSeek(-10); break;
      case 'l': case 'L': aulaSeek(10); break;
      case 'ArrowUp': aulaVolume(0.05); break;
      case 'ArrowDown': aulaVolume(-0.05); break;
      case 'm': case 'M': aula.video.muted = !aula.video.muted; break;
      case 'f': case 'F': aulaFullscreen(); break;
      case 'c': case 'C': aulaCycleCaptions(); break;
      case 'n': case 'N': aulaGo(1); break;
      case 'p': case 'P': aulaGo(-1); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  }

  /* ---------- arranque ---------- */

  function flushAll() {
    if (aula && aula.video && !aula.error) {
      var t = NaN;
      try { t = aula.video.currentTime; } catch (e) { t = NaN; }
      if (isNum(t) && t > 0) setPos(aula.slug, aula.src, t);
    }
    save(true);
  }

  function initBanner() {
    if (!bannerEl) return;
    if (window.location.protocol !== 'file:') { bannerEl.hidden = true; return; }
    var dismissed = false;
    try { dismissed = window.sessionStorage.getItem('platziLocal.banner') === '1'; } catch (e) { dismissed = false; }
    bannerEl.hidden = dismissed;
    var btn = bannerEl.querySelector('[data-control="banner-dismiss"]');
    if (btn) {
      btn.addEventListener('click', function () {
        bannerEl.hidden = true;
        try { window.sessionStorage.setItem('platziLocal.banner', '1'); } catch (e) { /* sin sessionStorage */ }
      });
    }
  }

  function init() {
    storageOK = probeStorage();
    if (storageOK) loadState(); else notice(MSG_STORAGE);
    initBanner();
    initSearch();
    if (chipEl) {
      chipEl.addEventListener('click', function () {
        var target = resumeTarget();
        if (target) gotoHash(hrefAula(target.course.slug, target.item.n));
      });
    }
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('hashchange', renderRoute);
    window.addEventListener('beforeunload', flushAll);
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushAll(); });
    renderRoute();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

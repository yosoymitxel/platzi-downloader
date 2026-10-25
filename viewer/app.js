/* Platzi Local — comportamiento del visor offline (ver viewer/SPEC.md §5).
   Vanilla + Plyr vendoreado (sin build); con file:// usa los controles nativos. */
(function () {
  'use strict';

  var STORAGE_KEY = 'platziLocal.v1';
  var SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
  var LANGS = ['es', 'en', 'pt'];
  var TRACK_LABEL = { es: 'Español', en: 'English', pt: 'Português' };
  var PLYR_I18N = {
    restart: 'Reiniciar',
    rewind: 'Retroceder {seektime}s',
    play: 'Reproducir',
    pause: 'Pausar',
    fastForward: 'Avanzar {seektime}s',
    seek: 'Buscar',
    seekLabel: '{currentTime} de {duration}',
    played: 'Reproducido',
    buffered: 'Cargado',
    currentTime: 'Tiempo actual',
    duration: 'Duración',
    volume: 'Volumen',
    mute: 'Silenciar',
    unmute: 'Activar sonido',
    enableCaptions: 'Activar subtítulos',
    disableCaptions: 'Desactivar subtítulos',
    download: 'Descargar',
    enterFullscreen: 'Pantalla completa',
    exitFullscreen: 'Salir de pantalla completa',
    frameTitle: 'Reproductor de {title}',
    captions: 'Subtítulos',
    settings: 'Ajustes',
    pip: 'Imagen en imagen',
    menuBack: 'Volver al menú anterior',
    speed: 'Velocidad',
    normal: 'Normal',
    quality: 'Calidad',
    loop: 'Repetir',
    start: 'Inicio',
    end: 'Fin',
    all: 'Todo',
    reset: 'Restablecer',
    disabled: 'Desactivado',
    enabled: 'Activado',
    advertisement: 'Anuncio',
    qualityBadge: { 2160: '4K', 1440: 'HD', 1080: 'HD', 720: 'HD', 576: 'SD', 480: 'SD' }
  };
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
  var publicCatalog = null;
  var publicCourses = [];
  var publicCatalogAvailable = false;
  var publicCatalogSyncState = { running: false, startedAt: null, finishedAt: null, ok: null, error: '' };
  var publicCatalogError = '';
  var importedRoute = null;

  var importingRoute = false;
  var exploreUi = {
    latest: { query: '', filters: [], limit: Infinity },
    routes: { query: '', sort: 'title', filters: [], limit: Infinity },
    courses: { query: '', filters: [], limit: 20 }
  };
  var courseServerState = Object.create(null);
  var lastSeenLocalRefresh = null;
  var localRefreshSeenRunning = false;
  var EXPLORE_FILTERS = ['all', 'downloaded', 'cert', 'queued', 'missing'];

  /* ---------- formato y utilidades ---------- */

  function normalizePublicCourse(course) {
    course = course || {};
    return {
      publicOnly: true,
      external: true,
      slug: String(course.slug || ''),
      title: String(course.title || course.slug || 'Curso de Platzi'),
      url: String(course.url || ''),
      cover: String(course.cover || ''),
      instructor: String(course.instructor || ''),
      duration: String(course.duration || ''),
      lessons: String(course.lessons || ''),
      isNew: !!course.isNew,
      source: String(course.source || '')
    };
  }

  function fetchPublicCatalog(callback) {
    if (window.location.protocol === 'file:' || typeof window.fetch !== 'function') {
      publicCatalogAvailable = false;
      publicCatalogError = 'Explorar requiere abrir el visor con viewer\\start.cmd.';
      if (callback) callback(null, new Error(publicCatalogError));
      return;
    }
    window.fetch('/api/catalog', { cache: 'no-store' }).then(function (response) {
      if (!response.ok) throw new Error('El servidor respondió ' + response.status + '.');
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.ok !== true || !payload.catalog) throw new Error('La respuesta del catálogo no es válida.');
      publicCatalog = payload.catalog;
      publicCourses = Array.isArray(publicCatalog.courses) ? publicCatalog.courses.map(normalizePublicCourse) : [];
      publicCatalogSyncState = payload.sync || publicCatalogSyncState;
      publicCatalogAvailable = true;
      publicCatalogError = '';
      searchIndex = null;
      if (searchInput && searchInput.value.trim() && searchBox && !searchBox.hidden) {
        openSuggest(searchSuggest(searchInput.value));
      }
      if (callback) callback(publicCatalog, null, publicCatalogSyncState);
    }).catch(function (error) {
      publicCatalogAvailable = false;
      publicCatalogError = (error && error.message) ? error.message : 'No se pudo leer la caché pública.';
      if (callback) callback(null, error, publicCatalogSyncState);
    });
  }

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

  var CHIP_TEXT = { cert: 'Aprobado', progress: 'En curso', downloaded: 'Descargado', queued: 'En cola', missing: 'Sin descargar', public: 'En Platzi' };

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
        img.setAttribute('src', /^https?:\/\//i.test(data.cover) ? data.cover : encodePath(data.cover));
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
  function hrefPublicRuta(id) { return '#/ruta-publica/' + encodeSeg(id); }
  function hrefAula(slug, n) { return '#/aula/' + encodeSeg(slug) + '/' + n; }

  function publicCourseForSlug(slug) {
    if (bySlug[slug]) return bySlug[slug];
    for (var i = 0; i < publicCourses.length; i++) if (publicCourses[i] && publicCourses[i].slug === slug) return publicCourses[i];
    return null;
  }

  function syncPublicQueueState(callback) {
    if (typeof window.fetch !== 'function') { if (callback) callback(); return; }
    window.fetch('/api/state', {cache: 'no-store'}).then(function (r) {
      if (!r.ok) throw new Error('No se pudo leer el estado de los cursos');
      return r.json();
    }).then(function (data) {
      var localCatalogState = data.catalog || {};
      if (lastSeenLocalRefresh === null) lastSeenLocalRefresh = localCatalogState.lastRefresh || null;
      if (localCatalogState.refreshing) {
        localRefreshSeenRunning = true;
      } else if (localRefreshSeenRunning && localCatalogState.lastRefresh &&
          localCatalogState.lastRefresh !== lastSeenLocalRefresh && localCatalogState.lastRefreshOk) {
        // El servidor ya regeneró viewer/data.js tras la descarga; recargar incorpora
        // módulos/clases recién descargados además de sus estados.
        window.location.reload();
        return;
      }
      if (localCatalogState.lastRefresh) lastSeenLocalRefresh = localCatalogState.lastRefresh;
      courseServerState = Object.create(null);
      (Array.isArray(data.items) ? data.items : []).forEach(function (item) {
        if (item && item.slug && ['queued', 'running', 'completed', 'error', 'canceled'].indexOf(item.status) >= 0) {
          courseServerState[item.slug] = item.status;
        }
      });
      function apply(course) {
        if (!course || !course.slug) return;
        var status = courseServerState[course.slug];
        if (status === 'queued' || status === 'running') course.queued = true;
        else course.queued = false;
        // Una descarga completada en esta sesión se refleja también en Explorar.
        if (status === 'completed') course.downloaded = true;
      }
      courses.forEach(apply);
      publicCourses.forEach(apply);
      if (callback) callback();
    }).catch(function () { if (callback) callback(); });
  }

  function exploreCourseState(raw) {
    var course = raw || {};
    var local = course.slug ? bySlug[course.slug] : null;
    var merged = local || course;
    var status = course.slug ? courseServerState[course.slug] : null;
    return {
      downloaded: !!merged.downloaded || status === 'completed',
      cert: !!merged.cert,
      queued: status === 'queued' || status === 'running' || (!!merged.queued && !status),
      progress: courseInProgress(merged)
    };
  }

  function exploreCourseMatches(raw, filters, query) {
    var title = norm((raw && (raw.title || raw.slug)) || '');
    if (query && title.indexOf(norm(query)) < 0) return false;
    var status = exploreCourseState(raw);
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (f === 'downloaded' && !status.downloaded) return false;
      if (f === 'cert' && !status.cert) return false;
      if (f === 'queued' && !status.queued) return false;
      if (f === 'missing' && status.downloaded) return false;
    }
    return true;
  }

  function toggleExploreFilter(filters, key) {
    if (!key || key === 'all') return [];
    var at = filters.indexOf(key);
    if (at >= 0) filters.splice(at, 1); else filters.push(key);
    return filters;
  }

  function paintExploreFilterButtons(view, block, filters) {
    var buttons = view.querySelectorAll('[data-explore-block="' + block + '"][data-explore-filter]');
    for (var i = 0; i < buttons.length; i++) {
      var key = buttons[i].getAttribute('data-explore-filter');
      buttons[i].setAttribute('aria-pressed', (key === 'all' ? !filters.length : filters.indexOf(key) >= 0) ? 'true' : 'false');
    }
  }

  function appendExploreMore(view, block, shown, total, onMore) {
    var button = view.querySelector('[data-explore-more="' + block + '"]');
    if (!button) return;
    button.hidden = shown >= total;
    button.textContent = 'Mostrar más (' + Math.min(20, Math.max(0, total - shown)) + ' de ' + total + ')';
    button.onclick = onMore;
  }

  function fillCourseCard(card, course) {
    if (!card || !course) return;
    var link = card.querySelector('a[data-slot="link"]') || hook(card, 'link');
    if (course.publicOnly) {
      var localCourse = bySlug[course.slug];
      if (localCourse) {
        var localStatus = courseServerState[course.slug];
        if (localStatus === 'completed') localCourse.downloaded = true;
        if (localStatus === 'queued' || localStatus === 'running') localCourse.queued = true;
        else if (localStatus) localCourse.queued = false;
        fillCourseCard(card, localCourse); return;
      }
      var mergedStatus = exploreCourseState(course);
      course.downloaded = mergedStatus.downloaded;
      course.queued = mergedStatus.queued;
      card.setAttribute('data-state', course.downloaded ? 'downloaded' : (course.queued ? 'queued' : 'public'));
      if (link) {
        link.setAttribute('href', hrefCurso(course.slug));
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
      fillCover(card, course);
      setText(card, 'title', course.title || course.slug);
      var publicMeta = [];
      if (course.instructor) publicMeta.push(course.instructor);
      if (course.duration) publicMeta.push(course.duration);
      if (course.lessons) publicMeta.push(course.lessons);
      setText(card, 'meta', publicMeta.join(' · ') || 'Catálogo público de Platzi');
      var publicStatus = hook(card, 'status');
      if (publicStatus) {
        fillChips(publicStatus, course);
        if (!course.downloaded && !course.queued) publicStatus.appendChild(chipNode('public'));
      }
      setProgress(card, 0, false);
      return;
    }
    card.setAttribute('data-state', courseState(course));
    if (link) {
      link.setAttribute('href', hrefCurso(course.slug));
      link.removeAttribute('target');
      link.removeAttribute('rel');
    }
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
    if (link) {
      if (isCourse && hint.external) {
        link.setAttribute('href', hint.url || ('https://platzi.com/cursos/' + encodeSeg(hint.slug) + '/'));
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      } else {
        link.setAttribute('href', isCourse ? hrefCurso(hint.slug) : hrefAula(hint.slug, hint.n));
        link.removeAttribute('target');
        link.removeAttribute('rel');
      }
    }
    setText(row, 'title', hint.title || '');
    setText(row, 'course', isCourse ? (hint.external ? 'Catálogo público de Platzi' : 'Curso') : (hint.courseTitle || ''));
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

  function fillPublicRouteCard(card, route) {
    if (!card || !route) return;
    if (card.tagName === 'A') {
      card.setAttribute('href', hrefPublicRuta(route.id));
      card.removeAttribute('target');
      card.removeAttribute('rel');
    }
    fillCover(card, route);
    setText(card, 'title', route.title || route.id);
    setText(card, 'meta', route.description || 'Ruta pública de Platzi');
    var progress = card.querySelector('.route-progress');
    if (progress) progress.hidden = true;
  }

  function paintExplore(view) {
    if (!view || !document.body.contains(view)) return;
    var data = publicCatalog || { courses: [], latest: [], routes: [], count: 0, routeCount: 0, syncedAt: null };
    var sync = publicCatalogSyncState || {};
    var status = hook(view, 'sync-status');
    var notice = hook(view, 'notice');
    var summary = hook(view, 'summary');
    var latest = Array.isArray(data.latest) ? data.latest : [];
    var routes = Array.isArray(data.routes) ? data.routes : [];
    var count = isNum(data.count) ? data.count : (Array.isArray(data.courses) ? data.courses.length : 0);
    var routeCount = isNum(data.routeCount) ? data.routeCount : routes.length;

    if (status) {
      if (sync.running) status.textContent = 'Actualizando catálogo público…';
      else if (sync.ok === false && sync.error) status.textContent = 'Falló la última actualización';
      else if (data.syncedAt) status.textContent = 'Actualizado ' + new Date(data.syncedAt).toLocaleString();
      else status.textContent = publicCatalogAvailable ? 'Todavía no sincronizado' : 'Requiere el servidor local';
    }
    if (summary) {
      summary.textContent = count + (count === 1 ? ' curso público' : ' cursos públicos') + ' · ' +
        routeCount + (routeCount === 1 ? ' ruta pública' : ' rutas públicas') +
        (data.syncedAt ? ' · Caché: ' + new Date(data.syncedAt).toLocaleString() : '');
    }
    if (notice) {
      if (!publicCatalogAvailable) {
        notice.textContent = publicCatalogError
          ? 'No se pudo leer el catálogo público: ' + publicCatalogError + ' La biblioteca local sigue disponible.'
          : 'Para cargar novedades y ampliar el buscador, abre el visor con viewer\\start.cmd. La biblioteca descargada sigue disponible sin conexión.';
      } else if (sync.running) {
        notice.textContent = 'Sincronizando cursos y rutas públicas. No se descargan vídeos; el resultado se guarda en SQLite local.';
      } else if (sync.ok === false && sync.error) {
        notice.textContent = 'No se pudo actualizar el catálogo. ' + sync.error;
      } else if (!data.syncedAt && !count && !routes.length) {
        notice.textContent = 'El catálogo público todavía no está guardado. Pulsa «Actualizar catálogo público» para importar cursos, lanzamientos y rutas desde Platzi.';
      } else {
        notice.textContent = 'El contenido público es una caché local actualizable. Tus cursos, progreso y rutas personales siguen separados.';
      }
    }

    var routeState = exploreUi.routes;
    var routeQuery = norm(routeState.query);
    var filteredRoutes = routes.filter(function (route) {
      return !routeQuery || norm((route.title || '') + ' ' + (route.description || '')).indexOf(routeQuery) >= 0;
    });
    filteredRoutes = filteredRoutes.filter(function (route) {
      var routeFilters = routeState.filters || [];
      var courseCount = Number(route.coursesCount || 0);
      if (routeFilters.indexOf('with-courses') >= 0 && !(courseCount > 0)) return false;
      if (routeFilters.indexOf('without-courses') >= 0 && courseCount > 0) return false;
      return true;
    });
    filteredRoutes.sort(function (x, y) {
      if (routeState.sort === 'count') return (Number(y.coursesCount || 0) - Number(x.coursesCount || 0)) || cmpTitle(x.title || x.id, y.title || y.id);
      return cmpTitle(x.title || x.id, y.title || y.id);
    });
    var routeBox = listHook(view, 'public-routes');
    var visibleRoutes = filteredRoutes.slice(0, routeState.limit);
    if (routeBox) {
      clearEl(routeBox);
      visibleRoutes.forEach(function (route) {
        var card = partial('tpl-route-card', function (node) { fillPublicRouteCard(node, route); });
        if (card) routeBox.appendChild(card);
      });
    }
    var routesEmpty = hook(view, 'routes-empty');
    if (routesEmpty) {
      routesEmpty.textContent = routes.length ? 'No hay rutas que coincidan con la búsqueda.' : 'No hay rutas públicas en la caché. Actualiza el catálogo.';
      routesEmpty.hidden = filteredRoutes.length > 0;
    }
    setText(view, 'routes-count', filteredRoutes.length + ' rutas');

    var allPublicCourses = publicCourses.slice();
    var publicCourseCount = hook(view, 'public-course-count');
    if (publicCourseCount) publicCourseCount.textContent = allPublicCourses.length + ' cursos';
    var courseStateUi = exploreUi.courses;
    var filteredPublicCourses = allPublicCourses.filter(function (course) {
      return exploreCourseMatches(course, courseStateUi.filters, courseStateUi.query);
    });
    var publicCoursesBox = listHook(view, 'public-courses');
    var visiblePublicCourses = filteredPublicCourses.slice(0, courseStateUi.limit);
    if (publicCoursesBox) {
      clearEl(publicCoursesBox);
      visiblePublicCourses.forEach(function (course) {
        var card = partial('tpl-course-card', function (node) { fillCourseCard(node, course); });
        if (card) publicCoursesBox.appendChild(card);
      });
    }
    setText(view, 'public-course-count', filteredPublicCourses.length + ' cursos');
    var publicCoursesEmpty = hook(view, 'public-courses-empty');
    if (publicCoursesEmpty) {
      publicCoursesEmpty.textContent = allPublicCourses.length ? 'Ningún curso coincide con los filtros.' : 'No hay cursos públicos en la caché. Actualiza el catálogo.';
      publicCoursesEmpty.hidden = filteredPublicCourses.length > 0;
    }
    paintExploreFilterButtons(view, 'courses', courseStateUi.filters);
    paintExploreFilterButtons(view, 'routes', routeState.filters || []);
    appendExploreMore(view, 'courses', visiblePublicCourses.length, filteredPublicCourses.length, function () {
      courseStateUi.limit += 20; paintExplore(view);
    });

    var latestState = exploreUi.latest;
    var normalizedLatest = latest.map(normalizePublicCourse);
    var filteredLatest = normalizedLatest.filter(function (course) {
      return exploreCourseMatches(course, latestState.filters, latestState.query);
    });
    var latestBox = listHook(view, 'latest');
    var visibleLatest = filteredLatest.slice(0, latestState.limit);
    if (latestBox) {
      clearEl(latestBox);
      visibleLatest.forEach(function (course) {
        var card = partial('tpl-course-card', function (node) { fillCourseCard(node, course); });
        if (card) latestBox.appendChild(card);
      });
    }
    var latestEmpty = hook(view, 'latest-empty');
    if (latestEmpty) {
      latestEmpty.textContent = data.syncedAt ? 'No hay lanzamientos que coincidan con los filtros.' : 'Sincroniza el catálogo para mostrar cursos nuevos.';
      latestEmpty.hidden = filteredLatest.length > 0;
    }
    paintExploreFilterButtons(view, 'latest', latestState.filters);

    var refreshButton = view.querySelector('[data-control="catalog-refresh"]');
    if (refreshButton) refreshButton.disabled = !publicCatalogAvailable || !!sync.running;
  }

  function pollExploreCourseState(view) {
    window.setTimeout(function () {
      if (!view || !document.body.contains(view)) return;
      syncPublicQueueState(function () {
        if (!document.body.contains(view)) return;
        paintExplore(view);
        pollExploreCourseState(view);
      });
    }, 2000);
  }

  function pollPublicCatalog(view) {
    if (!view || !document.body.contains(view)) return;
    window.setTimeout(function () {
      fetchPublicCatalog(function (_data, _error, sync) {
        if (!document.body.contains(view)) return;
        paintExplore(view);
        if (sync && sync.running) pollPublicCatalog(view);
      });
    }, 1500);
  }

  function startPublicCatalogSync(view) {
    if (!publicCatalogAvailable || (publicCatalogSyncState && publicCatalogSyncState.running)) return;
    publicCatalogSyncState = { running: true, startedAt: Date.now(), finishedAt: null, ok: null, error: '' };
    paintExplore(view);
    window.fetch('/api/catalog/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok) throw new Error((payload && payload.error) || ('El servidor respondió ' + response.status + '.'));
        return payload;
      });
    }).then(function (payload) {
      publicCatalogSyncState = payload.sync || publicCatalogSyncState;
      paintExplore(view);
      if (publicCatalogSyncState.running) pollPublicCatalog(view);
    }).catch(function (error) {
      publicCatalogSyncState = { running: false, ok: false, error: (error && error.message) || 'No se pudo iniciar la sincronización.' };
      paintExplore(view);
    });
  }

  function paintImportedRoute(view) {
    if (!view) return;
    var status = hook(view, 'import-status');
    var preview = hook(view, 'import-preview');
    var title = hook(view, 'import-title');
    var count = hook(view, 'import-count');
    var list = listHook(view, 'import-courses');
    var enqueueButton = view.querySelector('[data-control="enqueue-imported-route"]');
    if (preview) preview.hidden = !importedRoute;
    if (!importedRoute) return;
    if (title) title.textContent = importedRoute.title || 'Ruta de Platzi';
    var localBySlug = Object.create(null);
    for (var i = 0; i < courses.length; i++) if (courses[i] && courses[i].slug) localBySlug[courses[i].slug] = courses[i];
    var pending = importedRoute.courses.filter(function (c) {
      var local = localBySlug[c.slug];
      return !(local && local.downloaded) && !c.queued;
    });
    importedRoute.pending = pending;
    if (count) count.textContent = importedRoute.courses.length + ' cursos encontrados · ' + pending.length + ' por añadir (sin contar los ya descargados o en cola).';
    if (list) {
      clearEl(list);
      importedRoute.courses.forEach(function(course){
        var known=publicCourseForSlug(course.slug);
        if(!known){known=normalizePublicCourse(course);publicCourses.push(known);}
        else if(!bySlug[course.slug]){if(course.title)known.title=course.title;if(course.url)known.url=course.url;if(course.cover&&!known.cover)known.cover=course.cover;}
        var card=partial('tpl-course-card',function(node){fillCourseCard(node,known);});
        if(card)list.appendChild(card);
      });
    }
    if (enqueueButton) {
      enqueueButton.disabled = importingRoute || pending.length === 0;
      enqueueButton.textContent = pending.length ? 'Añadir ' + pending.length + ' cursos a Descargas' : 'No hay cursos pendientes';
    }
    if (status && !importingRoute && !status.textContent) status.textContent = 'Ruta lista para descargar.';
  }

  function importRouteFromExplore(view) {
    var input = view.querySelector('#public-route-url');
    var status = hook(view, 'import-status');
    var button = view.querySelector('[data-control="import-route"]');
    var url = input ? input.value.trim() : '';
    if (!url || importingRoute) return;
    importingRoute = true;
    importedRoute = null;
    if (status) status.textContent = 'Abriendo la ruta y leyendo sus cursos…';
    if (button) button.disabled = true;
    paintImportedRoute(view);
    window.fetch('/api/import-route', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url: url})
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || ('Error HTTP ' + response.status));
        return payload.route;
      });
    }).then(function (route) {
      importedRoute = route;
      if (status) status.textContent = 'Ruta leída. Revisa los cursos antes de añadirlos a la cola.';
    }).catch(function (error) {
      if (status) status.textContent = 'No se pudo leer la ruta: ' + (error.message || 'error desconocido');
    }).finally(function () {
      importingRoute = false;
      if (button) button.disabled = false;
      paintImportedRoute(view);
    });
  }

  function enqueueImportedRouteFromExplore(view) {
    if (!importedRoute || importingRoute || !Array.isArray(importedRoute.pending) || !importedRoute.pending.length) return;
    var status = hook(view, 'import-status');
    var button = view.querySelector('[data-control="enqueue-imported-route"]');
    var items = importedRoute.pending.map(function (c) { return {slug: c.slug, title: c.title}; });
    importingRoute = true;
    if (button) button.disabled = true;
    if (status) status.textContent = 'Añadiendo cursos a la cola de descargas…';
    window.fetch('/api/enqueue', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({items: items, position: 'back'})
    }).then(function (response) {
      return response.json().then(function (payload) {
        if (!response.ok || !payload.ok) throw new Error(payload.error || ('Error HTTP ' + response.status));
        return payload;
      });
    }).then(function (payload) {
      if (status) status.textContent = 'Listo: ' + payload.added + ' cursos añadidos a la cola de Descargas.';
      var queuedSlugs = Object.create(null);
      items.forEach(function (item) { queuedSlugs[item.slug] = true; });
      importedRoute.courses.forEach(function (course) { if (queuedSlugs[course.slug]) course.queued = true; });
      paintImportedRoute(view);
    }).catch(function (error) {
      if (status) status.textContent = 'No se pudo añadir la ruta: ' + (error.message || 'error desconocido');
    }).finally(function () {
      importingRoute = false;
      paintImportedRoute(view);
    });
  }

  function renderExplorar() {
    setTitle('Explorar · Platzi Local');
    renderShell('explorar');
    var view = mount('tpl-explorar', function (root) {
      root.addEventListener('input', function (event) {
        var target = event.target;
        var block = target && target.getAttribute('data-explore-search');
        if (!block || !exploreUi[block]) return;
        exploreUi[block].query = target.value || '';
        if (block === 'courses') exploreUi[block].limit = 20;
        paintExplore(root);
        var again = root.querySelector('[data-explore-search="' + block + '"]');
        if (again) { again.focus(); try { again.setSelectionRange(again.value.length, again.value.length); } catch (_) {} }
      });
      root.addEventListener('change', function (event) {
        var target = event.target;
        if (target && target.matches('[data-explore-sort="routes"]')) {
          exploreUi.routes.sort = target.value || 'title';
          paintExplore(root);
        }
      });
      root.addEventListener('click', function (event) {
        var button = event.target && event.target.closest ? event.target.closest('[data-explore-filter]') : null;
        if (!button || !root.contains(button)) return;
        var block = button.getAttribute('data-explore-block');
        var key = button.getAttribute('data-explore-filter');
        if (!exploreUi[block]) return;
        if (block === 'routes') {
          exploreUi.routes.filters = toggleExploreFilter(exploreUi.routes.filters || [], key);
        } else if (exploreUi[block].filters) {
          exploreUi[block].filters = toggleExploreFilter(exploreUi[block].filters, key);
        } else return;
        exploreUi[block].limit = 20;
        paintExplore(root);
      });
      var refreshButton = root.querySelector('[data-control="catalog-refresh"]');
      if (refreshButton) refreshButton.addEventListener('click', function () { startPublicCatalogSync(root); });
      var importForm = root.querySelector('[data-form="import-route"]');
      if (importForm) importForm.addEventListener('submit', function (event) {
        event.preventDefault();
        importRouteFromExplore(root);
      });
      var enqueueImported = root.querySelector('[data-control="enqueue-imported-route"]');
      if (enqueueImported) enqueueImported.addEventListener('click', function () { enqueueImportedRouteFromExplore(root); });
      paintExplore(root);
      paintImportedRoute(root);
      fetchPublicCatalog(function (_data, _error, sync) {
        if (!document.body.contains(root)) return;
        syncPublicQueueState(function(){ if(document.body.contains(root)) paintExplore(root); });
        paintExplore(root);
        pollExploreCourseState(root);
        if (sync && sync.running) pollPublicCatalog(root);
      });
    });
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

  function routeCourseList(route) {
    var ids = Array.isArray(route.courses) ? route.courses : [];
    var list = [];
    for (var i = 0; i < ids.length; i++) {
      var c = bySlug[ids[i]] || publicCourseForSlug(ids[i]);
      if (c) list.push(c);
    }
    return list;
  }

  function fillRuta(view, route, list) {
    setText(view, 'title', route.title || route.id);
    fillCover(view, route);
    var downloaded = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].downloaded) downloaded++;
    }
    var meta = routeMeta(route);
    if (downloaded) meta += ' · ' + downloaded + ' de ' + list.length + ' descargados';
    setText(view, 'meta', meta);
    var pct = routePct(route);
    var bar = hook(view, 'bar');
    if (bar) { bar.hidden = false; bar.style.width = pct + '%'; }
    setText(view, 'pct', pctText(pct));

    var filtered = list.filter(function (c) { return courseMatchesAll(c, rutaFilters); });
    var box = listHook(view, 'courses');
    if (box) {
      clearEl(box);
      for (var k = 0; k < filtered.length; k++) {
        var card = partial('tpl-course-card', (function (cc) { return function (n) { fillCourseCard(n, cc); }; })(filtered[k]));
        if (card) box.appendChild(card);
      }
    }
    setText(view, 'count', filtered.length + (filtered.length === 1 ? ' curso' : ' cursos'));
    paintFilterCounts(view, list);
    var emptyEl = hook(view, 'empty');
    if (emptyEl) {
      var msg = list.length === 0 ? 'Esta ruta todavía no tiene cursos' : cursosEmptyMessage(rutaFilters);
      if (emptyEl.textContent !== msg) emptyEl.textContent = msg;
      emptyEl.hidden = filtered.length !== 0;
    }
    paintFilterButtons(view, rutaFilters);

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
    rutaFilters = [];
    var list = routeCourseList(route);
    mount('tpl-ruta', function (view) {
      var btns = view.querySelectorAll('[data-filter]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          rutaFilters = toggleFilter(rutaFilters, this.getAttribute('data-filter'));
          fillRuta(view, route, list);
        });
      }
      fillRuta(view, route, list);
    });
    afterRoute();
  }

  function renderPublicRuta(routeId) {
    var routes = publicCatalog && Array.isArray(publicCatalog.routes) ? publicCatalog.routes : [];
    var route = null;
    for (var i = 0; i < routes.length; i++) if (String(routes[i].id) === String(routeId)) { route = routes[i]; break; }
    if (!route) { redirectTo('#/explorar'); return; }
    setTitle((route.title || route.id) + ' · Explorar · Platzi Local');
    renderShell('explorar');
    rutaFilters = [];
    mount('tpl-ruta', function (view) {
      setText(view, 'title', route.title || route.id);
      fillCover(view, route);
      setText(view, 'meta', 'Leyendo cursos de Platzi…');
      window.fetch('/api/import-route', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url:route.url})})
      .then(function (r) { return r.json().then(function (p) { if (!r.ok || !p.ok) throw new Error(p.error || ('HTTP '+r.status)); return p.route; }); })
      .then(function (details) {
        var ids = [];
        (details.courses || []).forEach(function (raw) {
          var c = normalizePublicCourse(raw), existing = publicCourseForSlug(c.slug);
          if (!existing) { publicCourses.push(c); existing = c; }
          else if (!bySlug[c.slug]) { if(c.title)existing.title=c.title; if(c.url)existing.url=c.url; if(c.cover&&!existing.cover)existing.cover=c.cover; }
          ids.push(existing.slug);
        });
        route.courses = ids; route.coursesCount = ids.length; route.title = details.title || route.title;
        setText(view, 'title', route.title); setText(view, 'meta', routeMeta(route) + ' · Ruta pública');
        var list = routeCourseList(route);
        function paint() {
          var filtered = list.filter(function(c){return courseMatchesAll(c,rutaFilters);});
          var box = listHook(view,'courses'); if(box) { clearEl(box); filtered.forEach(function(c){var card=partial('tpl-course-card',function(node){fillCourseCard(node,c);});if(card)box.appendChild(card);}); }
          setText(view,'count',filtered.length+(filtered.length===1?' curso':' cursos'));
          paintFilterCounts(view,list); paintFilterButtons(view,rutaFilters);
          var empty=hook(view,'empty'); if(empty){empty.textContent=list.length?cursosEmptyMessage(rutaFilters):'No se encontraron cursos en esta ruta pública.';empty.hidden=filtered.length>0;}
        }
        var bar=hook(view,'bar'); if(bar)bar.hidden=true; show(hook(view,'pct'),false);
        var cont=view.querySelector('a[data-slot="continue"]'); if(cont)cont.hidden=true;
        view.querySelectorAll('[data-filter]').forEach(function(btn){btn.addEventListener('click',function(){rutaFilters=toggleFilter(rutaFilters,this.getAttribute('data-filter'));paint();});});
        paint();
      }).catch(function(error){setText(view,'meta','No se pudo cargar el detalle de la ruta.');var empty=hook(view,'empty');if(empty){empty.textContent=error.message||'No se pudo leer la ruta de Platzi.';empty.hidden=false;}});
    });
    afterRoute();
  }

  /* ---------- catálogo ---------- */

  var cursoFilters = [];
  var rutaFilters = [];
  var CURSO_FILTERS = ['all', 'progress', 'cert', 'downloaded', 'queued', 'missing'];

  function sortedCatalog() {
    return courses.slice().sort(function (a, b) {
      var ca = a.cert ? 1 : 0;
      var cb = b.cert ? 1 : 0;
      if (ca !== cb) return ca - cb;
      var da = a.downloaded ? 0 : 1;
      var db = b.downloaded ? 0 : 1;
      if (da !== db) return da - db;
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

  /* Varios filtros activos se combinan con Y: cada uno debe cumplirse. */
  function courseMatchesAll(course, filters) {
    for (var i = 0; i < filters.length; i++) {
      if (!courseMatches(course, filters[i])) return false;
    }
    return true;
  }

  /* "Todos" no se acumula: limpia la selección. */
  function toggleFilter(filters, key) {
    if (!key || key === 'all') return [];
    for (var i = 0; i < filters.length; i++) {
      if (filters[i] === key) {
        filters.splice(i, 1);
        return filters;
      }
    }
    filters.push(key);
    return filters;
  }

  function paintFilterButtons(view, filters) {
    var btns = view.querySelectorAll('[data-filter]');
    for (var b = 0; b < btns.length; b++) {
      var key = btns[b].getAttribute('data-filter');
      var on = key === 'all' ? filters.length === 0 : filters.indexOf(key) >= 0;
      btns[b].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function paintFilterCounts(view, scope) {
    var counts = { all: scope.length };
    for (var f = 1; f < CURSO_FILTERS.length; f++) {
      var key = CURSO_FILTERS[f];
      counts[key] = 0;
      for (var c = 0; c < scope.length; c++) {
        if (courseMatches(scope[c], key)) counts[key]++;
      }
    }
    var countEls = view.querySelectorAll('[data-filter-count]');
    for (var e = 0; e < countEls.length; e++) {
      var k = countEls[e].getAttribute('data-filter-count');
      countEls[e].textContent = isNum(counts[k]) ? String(counts[k]) : '';
    }
  }

  function cursosEmptyMessage(filters) {
    return filters.length > 1 ? 'Ningún curso coincide con estos filtros' : 'Ningún curso coincide con este filtro';
  }

  function updateCursosList(view) {
    var box = listHook(view, 'courses');
    var filtered = sortedCatalog().filter(function (c) { return courseMatchesAll(c, cursoFilters); });
    if (box) {
      clearEl(box);
      for (var i = 0; i < filtered.length; i++) {
        var card = partial('tpl-course-card', (function (c) { return function (n) { fillCourseCard(n, c); }; })(filtered[i]));
        if (card) box.appendChild(card);
      }
    }
    setText(view, 'count', filtered.length + (filtered.length === 1 ? ' curso' : ' cursos'));
    paintFilterCounts(view, courses);
    var emptyEl = hook(view, 'empty');
    if (emptyEl) {
      var msg = courses.length === 0 ? 'Todavía no hay cursos en el catálogo' : cursosEmptyMessage(cursoFilters);
      if (emptyEl.textContent !== msg) emptyEl.textContent = msg;
      emptyEl.hidden = filtered.length !== 0;
    }
    paintFilterButtons(view, cursoFilters);
  }

  function renderCursos() {
    setTitle('Mis cursos · Platzi Local');
    renderShell('cursos');
    mount('tpl-cursos', function (view) {
      var btns = view.querySelectorAll('[data-filter]');
      for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
          cursoFilters = toggleFilter(cursoFilters, this.getAttribute('data-filter'));
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

    var platziLink = view.querySelector('a[data-slot="platzi-link"]');
    if (platziLink) {
      var courseUrl = (typeof course.url === 'string') ? course.url : '';
      if (courseUrl) {
        platziLink.hidden = false;
        platziLink.setAttribute('href', courseUrl);
      } else {
        platziLink.hidden = true;
        platziLink.removeAttribute('href');
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

    courseDownloadAction(view, course);

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

  function courseDownloadAction(view, course) {
    var btn = view.querySelector('[data-control="download-course"]');
    if (!btn) return;
    var status = hook(view, 'download-status');
    var name = course.title || course.slug;

    function labelDownload(text, disabled) {
      setLabel(btn, text);
      btn.disabled = !!disabled;
    }
    function paintQueued(item) {
      var running = item && item.status === 'running';
      labelDownload(running ? 'Descargando…' : 'En cola', true);
      btn.setAttribute('aria-label', (running ? 'Descargando ' : 'En cola: ') + name);
    }
    function findItem(data) {
      var items = (data && Array.isArray(data.items)) ? data.items : [];
      for (var i = 0; i < items.length; i++) {
        if (items[i] && items[i].slug === course.slug) return items[i];
      }
      return null;
    }

    if (course.downloaded || !dlHasServer()) {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    labelDownload('Descargar curso', false);
    btn.setAttribute('aria-label', 'Descargar ' + name);

    dlApi('/state').then(function (data) {
      var item = findItem(data);
      if (item && (item.status === 'queued' || item.status === 'running')) paintQueued(item);
    }).catch(function () { /* sin servidor: queda el botón para reintentar */ });

    btn.addEventListener('click', function () {
      if (btn.disabled) return;
      btn.disabled = true;
      setLabel(btn, 'Encolando…');
      if (status) status.textContent = '';
      dlApi('/enqueue', { items: [{ slug: course.slug, title: name }], position: 'back' })
        .then(function (data) {
          paintQueued(findItem(data) || { status: 'queued' });
          if (status) status.textContent = '«' + name + '» añadido a la cola de descargas.';
        })
        .catch(function (err) {
          labelDownload('Descargar curso', false);
          if (status) status.textContent = (err && err.message) ? err.message : 'No se pudo encolar. Revisa que el servidor local esté activo.';
        });
    });
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
    syncCaptionsUI(view, lang);
  }

  function syncCaptionsUI(view, lang) {
    var sel = view ? view.querySelector('select[data-control="captions"]') : null;
    if (sel && sel.value !== lang) sel.value = lang;
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
    if (a.player && typeof a.player.destroy === 'function') {
      try { a.player.destroy(); } catch (e) { /* Plyr ya destruido */ }
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
    if (!a) return;
    if (a.player && a.player.fullscreen) { a.player.fullscreen.toggle(); return; }
    if (!a.video) return;
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
    if (a.player) {
      var active = !!(a.player.captions && a.player.captions.active);
      var cur = (active && a.player.currentTrack >= 0) ? (a.player.language || 'off') : 'off';
      var idx = seq.indexOf(cur);
      var next = seq[(idx + 1) % seq.length];
      if (next === 'off') a.player.toggleCaptions(false);
      else {
        a.player.language = next;
        a.player.toggleCaptions(true);
      }
      state.prefs.captions = next;
      save();
      syncCaptionsUI(a.view, next);
      return;
    }
    var i = seq.indexOf(state.prefs.captions);
    var nxt = seq[(i + 1) % seq.length];
    applyCaptions(nxt, a.video, a.view, true);
  }

  function syncCaptionsPref() {
    var a = aula;
    if (!a || !a.player) return;
    var active = !!(a.player.captions && a.player.captions.active);
    var lang = (active && a.player.currentTrack >= 0) ? (a.player.language || 'es') : 'off';
    if (state.prefs.captions !== lang) {
      state.prefs.captions = lang;
      save();
    }
    syncCaptionsUI(a.view, lang);
  }

  function buildAula(view, course, n, item, fl) {
    var video = view.querySelector('video#player') || view.querySelector('video');
    var prevBtn = view.querySelector('[data-control="prev"]');
    var nextBtn = view.querySelector('[data-control="next"]');
    var markBtn = view.querySelector('[data-control="mark"]');
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

      var captionsSel = view.querySelector('select[data-control="captions"]');
      if (captionsSel) {
        for (var ci = 0; ci < aula.subLangs.length; ci++) {
          var ccode = aula.subLangs[ci];
          var copt = document.createElement('option');
          copt.value = ccode;
          copt.textContent = TRACK_LABEL[ccode];
          captionsSel.appendChild(copt);
        }
        var prefLang = state.prefs.captions;
        captionsSel.value = (prefLang === 'off' || aula.subLangs.indexOf(prefLang) >= 0) ? prefLang : 'off';
        captionsSel.addEventListener('change', function () {
          if (!aula) return;
          var lang = captionsSel.value;
          var a = aula;
          if (a.player) {
            if (lang === 'off') a.player.toggleCaptions(false);
            else {
              a.player.language = lang;
              a.player.toggleCaptions(true);
            }
            state.prefs.captions = lang;
            save();
          } else {
            applyCaptions(lang, a.video, a.view, true);
          }
        });
      }

      video.playbackRate = speed;
      video.volume = clamp01(state.prefs.volume);

      if (window.Plyr && location.protocol !== 'file:') {
        try {
          var player = new window.Plyr(video, {
            controls: ['play-large', 'play', 'progress', 'current-time', 'duration', 'mute', 'volume', 'captions', 'settings', 'pip', 'fullscreen'],
            settings: ['speed'],
            speed: { selected: speed, options: SPEEDS },
            volume: clamp01(state.prefs.volume),
            invertTime: false,
            toggleInvert: true,
            keyboard: { focused: false, global: false },
            tooltips: { controls: true, seek: true },
            storage: { enabled: false },
            title: item.title || '',
            iconUrl: 'vendor/plyr/plyr.svg',
            i18n: PLYR_I18N,
            captions: {
              active: state.prefs.captions !== 'off',
              language: state.prefs.captions !== 'off' ? state.prefs.captions : 'auto',
              update: true
            }
          });
          aula.player = player;
          player.on('captionsenabled', syncCaptionsPref);
          player.on('captionsdisabled', syncCaptionsPref);
          player.on('languagechange', syncCaptionsPref);
        } catch (e) {
          aula.player = null;
        }
      }
      if (!aula.player) {
        video.setAttribute('controls', 'controls');
        applyCaptions(state.prefs.captions, video, view, false);
      }

      video.addEventListener('loadedmetadata', function () {
        /* Con Plyr manda su módulo de subtítulos; sin Plyr, reaplicar la preferencia. */
        if (!aula || !aula.player) applyCaptions(state.prefs.captions, video, view, false);
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
      video.addEventListener('ratechange', function () {
        var r = video.playbackRate;
        if (isNum(r) && r > 0 && state.prefs.speed !== r) { state.prefs.speed = r; save(); }
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
    var seen = Object.create(null);
    for (var i = 0; i < courses.length; i++) {
      var c = courses[i];
      seen[c.slug] = true;
      searchIndex.push({ type: 'course', norm: norm((c.title || '') + ' ' + (c.slug || '')), title: c.title || c.slug, slug: c.slug, n: 0, courseTitle: '', time: null });
      var fl = flatClasses(c);
      for (var j = 0; j < fl.length; j++) {
        searchIndex.push({ type: 'class', norm: norm(fl[j].title), title: fl[j].title, slug: c.slug, n: fl[j].n, courseTitle: c.title || c.slug, time: fl[j].durationSec });
      }
    }
    for (var k = 0; k < publicCourses.length; k++) {
      var pc = publicCourses[k];
      if (!pc.slug || seen[pc.slug]) continue;
      seen[pc.slug] = true;
      searchIndex.push({
        type: 'course',
        norm: norm([pc.title, pc.slug, pc.instructor].join(' ')),
        title: pc.title || pc.slug,
        slug: pc.slug,
        n: 0,
        courseTitle: '',
        time: null,
        external: true,
        publicOnly: true,
        url: pc.url,
        cover: pc.cover,
        instructor: pc.instructor,
        duration: pc.duration,
        lessons: pc.lessons,
        isNew: pc.isNew
      });
    }
    return searchIndex;
  }

  function hitRank(hit) {
    var c = bySlug[hit.it.slug];
    if (c && c.downloaded) return 0;
    if (c) return 1;
    return hit.it.external ? 2 : 3;
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
    function cmp(a, b) { return hitRank(a) - hitRank(b) || a.at - b.at || a.len - b.len || cmpTitle(a.it.title, b.it.title); }
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
      var r = hitRank(a.hit) - hitRank(b.hit);
      if (r) return r;
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
          var target = a ? a.getAttribute('target') : null;
          closeSuggest();
          if (href && target === '_blank') window.open(href, '_blank', 'noopener,noreferrer');
          else gotoHash(href);
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
          var c = bySlug[res.courses[i].it.slug] || res.courses[i].it;
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

  /* ---------- descargas ---------- */

  var DL_POLL_MS = 1500;
  var DL_HISTORY_MAX = 8;
  var DL_SUGGEST_MAX = 10;

  var dlView = null;
  var dlTimer = null;
  var dlState = null;
  var dlOffline = false;
  var dlBusy = false;
  var dlQuery = '';
  var dlNotice = '';
  var dlNoticeReload = false;
  var dlPrevStatus = null;
  var dlPrevBusySig = null;
  var dlPrevQueueSig = null;
  var dlPrevHistorySig = null;
  var dlPrevRefreshing = false;
  var dlCoursePool = null;

  function dlHasServer() {
    return window.location.protocol !== 'file:';
  }

  function dlApi(path, body) {
    var opts = {
      method: body ? 'POST' : 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch('/api' + path, opts).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok || !data || data.ok === false) {
          throw new Error((data && data.error) ? data.error : 'El servidor respondió con error ' + res.status + '.');
        }
        return data;
      });
    });
  }

  function dlItemsByStatus(status) {
    var out = [];
    var items = (dlState && Array.isArray(dlState.items)) ? dlState.items : [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].status === status) out.push(items[i]);
    }
    return out;
  }

  function dlBusySet() {
    var set = Object.create(null);
    var items = (dlState && Array.isArray(dlState.items)) ? dlState.items : [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it && (it.status === 'queued' || it.status === 'running')) set[it.slug] = true;
    }
    return set;
  }

  function dlTitleOf(slug) {
    var c = bySlug[slug];
    return (c && c.title) ? c.title : slug;
  }

  function dlCourseMeta(course) {
    var n = totalClasses(course);
    var sec = (isNum(course.durationSec) && course.durationSec > 0) ? course.durationSec
      : (isNum(course.hours) ? course.hours * 3600 : null);
    var dur = fmtDuration(sec);
    var parts = [];
    if (n > 0) parts.push(n + (n === 1 ? ' clase' : ' clases'));
    if (dur) parts.push(dur);
    return parts.join(' · ');
  }

  function dlMetaOf(slug) {
    var c = bySlug[slug];
    return c ? dlCourseMeta(c) : '';
  }

  function dlDate(ms) {
    if (!isNum(ms) || ms <= 0) return '';
    var d = new Date(ms);
    var now = new Date();
    var hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) {
      return 'Hoy, ' + hm;
    }
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + hm;
  }

  function dlCaptureFocus() {
    var el = document.activeElement;
    if (!el || !dlView || !dlView.contains(el)) return '';
    return el.getAttribute ? (el.getAttribute('data-focus') || '') : '';
  }

  function dlRestoreFocus(key) {
    if (!key || !dlView) return;
    var active = document.activeElement;
    if (active && active !== document.body && !dlView.contains(active)) return;
    var nodes = dlView.querySelectorAll('[data-focus]');
    var target = null;
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute('data-focus') === key && !nodes[i].disabled) { target = nodes[i]; break; }
    }
    if (!target) {
      var parts = key.split(':');
      var prefix = parts[0] + ':';
      var slug = parts[1] || '';
      if (prefix === 'queue:' && slug) {
        var alts = ['down', 'up', 'cancel'];
        for (var a = 0; a < alts.length && !target; a++) {
          for (i = 0; i < nodes.length; i++) {
            if (nodes[i].getAttribute('data-focus') === 'queue:' + slug + ':' + alts[a] && !nodes[i].disabled) {
              target = nodes[i];
              break;
            }
          }
        }
      }
      if (!target) {
        for (i = 0; i < nodes.length; i++) {
          if (nodes[i].getAttribute('data-focus').indexOf(prefix) === 0 && !nodes[i].disabled) {
            target = nodes[i];
            break;
          }
        }
      }
    }
    if (!target) {
      var kind = key.split(':')[0];
      if (kind === 'queue') target = document.getElementById('dl-queue-title');
      else if (kind === 'history') target = document.getElementById('dl-history-title');
      else target = appEl;
    }
    if (target && target.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  function dlGoAdd(view) {
    var box = view.querySelector('.dl-add');
    var input = view.querySelector('[data-control="search"]');
    if (box && box.scrollIntoView) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { box.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
      catch (e) { box.scrollIntoView(); }
    }
    if (input) {
      try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
    }
  }

  function dlGoRoutes(view) {
    var box = view.querySelector('.dl-routes');
    if (box && box.scrollIntoView) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      try { box.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); }
      catch (e) { box.scrollIntoView(); }
    }
    var title = document.getElementById('dl-routes-title');
    if (title && title.focus) {
      try { title.focus({ preventScroll: true }); } catch (e) { title.focus(); }
    }
  }

  function dlRoutePending(route) {
    var out = [];
    var busy = dlBusySet();
    var ids = Array.isArray(route && route.courses) ? route.courses : [];
    for (var i = 0; i < ids.length; i++) {
      var c = bySlug[ids[i]];
      if (!c || c.downloaded || busy[c.slug]) continue;
      out.push(c);
    }
    return out;
  }

  function dlRenderSummary(view, items, offline, catalog) {
    var el = hook(view, 'summary');
    if (!el) return;
    if (offline) { el.textContent = 'Sin conexión con el servidor local.'; return; }
    var counts = { queued: 0, running: 0, completed: 0, error: 0 };
    var fresh = false;
    var lastRefresh = (catalog && catalog.lastRefresh) ? catalog.lastRefresh : 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (counts[it.status] != null) counts[it.status]++;
      if (it.status === 'completed' && (it.finishedAt || 0) > lastRefresh) fresh = true;
    }
    var parts = [];
    if (counts.running) parts.push(counts.running + ' descargando');
    if (counts.queued) parts.push(counts.queued + ' en cola');
    if (counts.completed) parts.push(counts.completed + (counts.completed === 1 ? ' completado' : ' completados'));
    if (counts.error) parts.push(counts.error + (counts.error === 1 ? ' con error' : ' con error'));
    var text = parts.length ? parts.join(' · ') : 'Sin descargas todavía.';
    if (fresh && !counts.running && !counts.queued) text += ' · catálogo pendiente de actualizar';
    el.textContent = text;
  }

  function dlRenderActive(view, running) {
    var box = hook(view, 'active');
    if (!box) return;
    var active = running.length ? running[0] : null;
    box.hidden = !active;
    if (!active) return;
    setText(view, 'active-title', active.title || dlTitleOf(active.slug));
    var pct = clamp(isNum(active.progress) ? active.progress : 0, 0, 100);
    var fill = hook(view, 'active-fill');
    if (fill) fill.style.width = pct + '%';
    var bar = hook(view, 'active-bar');
    if (bar) {
      bar.setAttribute('aria-valuenow', String(pct));
      bar.setAttribute('aria-valuetext', pct + ' por ciento');
    }
    setText(view, 'active-pct', pct + '%');
    setText(view, 'active-phase', active.phase || 'Preparando');
  }

  function dlFillQueueItem(node, item, index, total, offline) {
    setText(node, 'pos', String(index + 1));
    setText(node, 'title', item.title || dlTitleOf(item.slug));
    var meta = dlMetaOf(item.slug);
    setText(node, 'meta', meta);
    var metaEl = hook(node, 'meta');
    if (metaEl) metaEl.hidden = !meta;
    var name = item.title || item.slug;
    var up = node.querySelector('[data-action="up"]');
    var down = node.querySelector('[data-action="down"]');
    var cancel = node.querySelector('[data-action="cancel"]');
    if (up) {
      up.setAttribute('data-slug', item.slug);
      up.setAttribute('data-focus', 'queue:' + item.slug + ':up');
      up.setAttribute('aria-label', 'Subir ' + name);
      up.disabled = offline || index === 0;
    }
    if (down) {
      down.setAttribute('data-slug', item.slug);
      down.setAttribute('data-focus', 'queue:' + item.slug + ':down');
      down.setAttribute('aria-label', 'Bajar ' + name);
      down.disabled = offline || index === total - 1;
    }
    if (cancel) {
      cancel.setAttribute('data-slug', item.slug);
      cancel.setAttribute('data-focus', 'queue:' + item.slug + ':cancel');
      cancel.setAttribute('aria-label', 'Cancelar ' + name);
      cancel.disabled = offline;
    }
  }

  function dlRenderQueue(view, queued, offline) {
    var box = listHook(view, 'queue');
    var empty = hook(view, 'queue-empty');
    if (!box) return;
    clearEl(box);
    for (var i = 0; i < queued.length; i++) {
      var node = partial('tpl-dl-item', (function (it, index, total) {
        return function (n) { dlFillQueueItem(n, it, index, total, offline); };
      })(queued[i], i, queued.length));
      if (node) box.appendChild(node);
    }
    if (empty) empty.hidden = queued.length !== 0;
    setText(view, 'queue-count', queued.length ? queued.length + (queued.length === 1 ? ' curso' : ' cursos') : '');
  }

  function dlFillRoute(node, data, offline) {
    var route = data.route;
    setText(node, 'title', route.title || route.id);
    var open = node.querySelector('a[data-slot="route-link"]');
    if (open) {
      open.setAttribute('href', hrefRuta(route.id));
      open.setAttribute('data-focus', 'route:' + route.id + ':open');
      open.setAttribute('aria-label', 'Abrir ruta ' + (route.title || route.id));
    }
    var meta = data.downloaded + ' de ' + data.total + ' descargados';
    if (data.queued) meta += ' · ' + data.queued + ' en cola';
    setText(node, 'meta', meta);
    var pct = data.total ? Math.round((data.downloaded / data.total) * 100) : 0;
    var bar = hook(node, 'bar');
    if (bar) bar.style.width = pct + '%';
    var btn = node.querySelector('[data-control="route-download"]');
    var label = hook(node, 'label');
    if (!btn) return;
    var n = data.pending.length;
    btn.setAttribute('data-route', route.id);
    btn.setAttribute('data-focus', 'route:' + route.id + ':download');
    btn.disabled = offline || n === 0;
    if (label) label.textContent = n ? 'Descargar ' + n : (data.queued ? 'Ya en cola' : 'Sin pendientes');
    if (n) {
      btn.setAttribute('aria-label', 'Descargar ' + n + (n === 1 ? ' curso pendiente' : ' cursos pendientes') + ' de ' + (route.title || route.id));
    } else if (data.queued) {
      btn.setAttribute('aria-label', 'Cursos de ' + (route.title || route.id) + ' ya en cola');
    } else {
      btn.setAttribute('aria-label', (route.title || route.id) + ' ya está descargada');
    }
  }

  function dlRenderRoutes(view, offline) {
    var box = listHook(view, 'routes');
    if (!box) return;
    var busy = dlBusySet();
    var rows = [];
    for (var i = 0; i < routeList.length; i++) {
      var route = routeList[i];
      if (!route || !Array.isArray(route.courses)) continue;
      var total = 0;
      var downloaded = 0;
      var queued = 0;
      var pending = [];
      for (var j = 0; j < route.courses.length; j++) {
        var c = bySlug[route.courses[j]];
        if (!c) continue;
        total++;
        if (c.downloaded) { downloaded++; continue; }
        if (busy[c.slug]) { queued++; continue; }
        pending.push(c);
      }
      if (!total) continue;
      rows.push({ route: route, total: total, downloaded: downloaded, queued: queued, pending: pending });
    }
    rows.sort(function (a, b) {
      var ca = a.pending.length === 0 ? 0 : 1;
      var cb = b.pending.length === 0 ? 0 : 1;
      if (ca !== cb) return ca - cb;
      if (b.pending.length !== a.pending.length) return b.pending.length - a.pending.length;
      return cmpTitle(a.route.title || a.route.id, b.route.title || b.route.id);
    });
    clearEl(box);
    for (var k = 0; k < rows.length; k++) {
      var node = partial('tpl-dl-route', (function (data) {
        return function (n) { dlFillRoute(n, data, offline); };
      })(rows[k]));
      if (node) box.appendChild(node);
    }
    var empty = hook(view, 'routes-empty');
    if (empty) empty.hidden = rows.length !== 0;
    setText(view, 'routes-count', rows.length ? rows.length + (rows.length === 1 ? ' ruta' : ' rutas') : '');
  }

  function dlFillCourse(node, course, offline) {
    setText(node, 'title', course.title || course.slug);
    var meta = dlCourseMeta(course);
    setText(node, 'meta', meta);
    var metaEl = hook(node, 'meta');
    if (metaEl) metaEl.hidden = !meta;
    var downloaded = !!course.downloaded;
    var chip = hook(node, 'downloaded');
    if (chip) chip.hidden = !downloaded;
    var name = course.title || course.slug;
    var add = node.querySelector('[data-action="add"]');
    var front = node.querySelector('[data-action="front"]');
    if (add) {
      add.setAttribute('data-slug', course.slug);
      add.setAttribute('data-focus', 'course:' + course.slug + ':add');
      add.setAttribute('aria-label', 'Añadir ' + name + ' a la cola');
      add.hidden = downloaded;
      add.disabled = offline;
    }
    if (front) {
      front.setAttribute('data-slug', course.slug);
      front.setAttribute('data-focus', 'course:' + course.slug + ':front');
      front.setAttribute('aria-label', 'Poner ' + name + ' al frente de la cola');
      front.hidden = downloaded;
      front.disabled = offline;
    }
  }

  function dlRenderCourses(view, offline) {
    var box = listHook(view, 'courses');
    if (!box) return;
    if (!dlCoursePool) {
      var pool = [];
      for (var i = 0; i < courses.length; i++) {
        var c = courses[i];
        if (c && typeof c.slug === 'string') pool.push(c);
      }
      pool.sort(function (a, b) {
        var da = a.downloaded ? 0 : 1;
        var db = b.downloaded ? 0 : 1;
        if (da !== db) return da - db;
        return cmpTitle(a.title || a.slug, b.title || b.slug);
      });
      dlCoursePool = pool;
    }
    var busy = dlBusySet();
    var q = norm(dlQuery);
    var matches = [];
    var matched = 0;
    var matchedDesc = 0;
    var downloaded = 0;
    var pending = 0;
    for (var j = 0; j < dlCoursePool.length; j++) {
      var course = dlCoursePool[j];
      if (busy[course.slug]) continue;
      if (course.downloaded) downloaded++; else pending++;
      if (q && norm((course.title || '') + ' ' + course.slug).indexOf(q) < 0) continue;
      matched++;
      if (course.downloaded) matchedDesc++;
      if (matches.length >= DL_SUGGEST_MAX) continue;
      matches.push(course);
    }
    clearEl(box);
    for (var k = 0; k < matches.length; k++) {
      var node = partial('tpl-dl-course', (function (course) {
        return function (n) { dlFillCourse(n, course, offline); };
      })(matches[k]));
      if (node) box.appendChild(node);
    }
    var count;
    if (q) {
      count = matched + (matched === 1 ? ' resultado' : ' resultados');
      if (matchedDesc) count += ' · ' + (matchedDesc === 1 ? '1 descargado' : matchedDesc + ' descargados');
    } else {
      var parts = [];
      if (downloaded) parts.push(downloaded === 1 ? '1 descargado' : downloaded + ' descargados');
      if (pending) parts.push(pending + ' sin descargar');
      count = parts.join(' · ');
    }
    setText(view, 'add-count', count);
    var empty = hook(view, 'add-empty');
    if (empty) {
      empty.hidden = matches.length !== 0;
      if (!matches.length) {
        empty.textContent = q ? 'No hay cursos que coincidan con «' + dlQuery + '».' : 'Todos tus cursos están descargados o en cola.';
      }
    }
  }

  function dlFillHistory(node, item, offline) {
    var status = item.status;
    var chip = hook(node, 'status');
    if (chip) {
      chip.className = 'dl-status ' + (status === 'completed' ? 'dl-status-ok' : status === 'error' ? 'dl-status-error' : 'dl-status-canceled');
      chip.textContent = status === 'completed' ? 'Completado' : status === 'error' ? 'Error' : 'Cancelado';
    }
    setText(node, 'title', item.title || dlTitleOf(item.slug));
    var meta = '';
    if (status === 'error' && item.error) meta = item.error;
    else if (item.finishedAt) meta = dlDate(item.finishedAt);
    var metaEl = hook(node, 'meta');
    if (metaEl) { metaEl.textContent = meta; metaEl.hidden = !meta; }
    var name = item.title || item.slug;
    var retry = node.querySelector('[data-action="retry"]');
    var remove = node.querySelector('[data-action="remove"]');
    if (retry) {
      retry.setAttribute('data-slug', item.slug);
      retry.setAttribute('data-focus', 'history:' + item.slug + ':retry');
      retry.setAttribute('aria-label', 'Volver a descargar ' + name);
      retry.disabled = offline;
    }
    if (remove) {
      remove.setAttribute('data-slug', item.slug);
      remove.setAttribute('data-focus', 'history:' + item.slug + ':remove');
      remove.setAttribute('aria-label', 'Quitar ' + name + ' de la lista');
      remove.disabled = offline;
    }
  }

  function dlRenderHistory(view, history, offline) {
    var section = hook(view, 'history');
    var box = listHook(view, 'history');
    if (!section || !box) return;
    var shown = history.slice(0, DL_HISTORY_MAX);
    clearEl(box);
    for (var i = 0; i < shown.length; i++) {
      var node = partial('tpl-dl-history', (function (item) {
        return function (n) { dlFillHistory(n, item, offline); };
      })(shown[i]));
      if (node) box.appendChild(node);
    }
    section.hidden = shown.length === 0;
  }



  function dlUpdateNotice(view) {
    var box = hook(view, 'notice');
    var text = hook(view, 'notice-text');
    var reload = view.querySelector('[data-control="reload"]');
    if (box) box.hidden = !dlNotice;
    if (text) text.textContent = dlNotice || '';
    if (reload) reload.hidden = !dlNoticeReload;
  }

  function dlUpdateRefresh(view, offline, items) {
    var btn = view.querySelector('[data-control="refresh"]');
    var label = hook(view, 'refresh-label');
    if (!btn) return;
    var catalog = (dlState && dlState.catalog) ? dlState.catalog : {};
    var active = false;
    for (var i = 0; i < items.length; i++) {
      if (items[i].status === 'queued' || items[i].status === 'running') { active = true; break; }
    }
    var refreshing = !!catalog.refreshing;
    btn.disabled = offline || active || refreshing;
    if (label) label.textContent = refreshing ? 'Actualizando…' : 'Actualizar catálogo';
    if (active && !refreshing) btn.setAttribute('title', 'Espera a que termine la cola para actualizar el catálogo.');
    else btn.removeAttribute('title');
  }

  function dlAnnounce(view, items, offline) {
    var live = hook(view, 'live');
    if (!live) return;
    if (offline) { dlPrevStatus = null; return; }
    var map = Object.create(null);
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].slug) map[items[i].slug] = items[i].status;
    }
    if (!dlPrevStatus) { dlPrevStatus = map; return; }
    var messages = [];
    for (var j = 0; j < items.length; j++) {
      var it = items[j];
      var before = dlPrevStatus[it.slug];
      if (before === it.status) continue;
      var name = it.title || it.slug;
      if (it.status === 'running') messages.push('Descargando ' + name + '.');
      else if (it.status === 'completed') messages.push(name + ' completado.');
      else if (it.status === 'error') messages.push(name + ' falló: ' + (it.error || 'error desconocido') + '.');
      else if (it.status === 'canceled') messages.push(name + ' cancelado.');
    }
    dlPrevStatus = map;
    if (messages.length) live.textContent = messages.join(' ');
  }

  function dlApplyState(view, data) {
    if (!view) return;
    var focusKey = dlCaptureFocus();
    if (data) {
      dlState = data;
      dlOffline = false;
    }
    var offline = dlOffline || !dlHasServer();
    var items = (dlState && Array.isArray(dlState.items)) ? dlState.items : [];
    var running = [];
    var queued = [];
    var history = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.slug !== 'string') continue;
      if (it.status === 'running') running.push(it);
      else if (it.status === 'queued') queued.push(it);
      else history.push(it);
    }
    history.sort(function (a, b) { return (b.finishedAt || 0) - (a.finishedAt || 0); });

    var catalog = (dlState && dlState.catalog) ? dlState.catalog : {};
    var wasRefreshing = dlPrevRefreshing;
    dlPrevRefreshing = !!catalog.refreshing;
    if (wasRefreshing && !dlPrevRefreshing) {
      if (catalog.lastRefreshOk) {
        dlNotice = 'Catálogo actualizado. Recarga el visor para verlo.';
        dlNoticeReload = true;
      } else {
        dlNotice = 'No se pudo actualizar el catálogo. Revisa la consola del servidor.';
        dlNoticeReload = false;
      }
    }

    dlRenderSummary(view, items, offline, catalog);

    var banner = hook(view, 'offline');
    if (banner) banner.hidden = !offline;

    var cli = hook(view, 'cli-warning');
    if (cli) cli.hidden = offline || !dlState || dlState.cliAvailable !== false;

    var session = (dlState && dlState.session) ? dlState.session : null;
    var sessionBanner = hook(view, 'session-warning');
    if (sessionBanner) {
      var loggedOut = !!(session && session.loggedIn === false);
      sessionBanner.hidden = offline || !loggedOut;
    }
    var sessionStatus = hook(view, 'session-status');
    if (sessionStatus) {
      if (offline) sessionStatus.textContent = 'Sesión: sin conexión';
      else if (!session || session.loggedIn === null) sessionStatus.textContent = 'Sesión: sin comprobar';
      else if (session.loggedIn === true) sessionStatus.textContent = 'Sesión: iniciada';
      else sessionStatus.textContent = 'Sesión: no iniciada';
    }

    dlRenderActive(view, running);

    var queueSig = (offline ? 'offline' : 'online') + '|';
    for (var q = 0; q < queued.length; q++) queueSig += queued[q].slug + '|';
    if (queueSig !== dlPrevQueueSig) {
      dlPrevQueueSig = queueSig;
      dlRenderQueue(view, queued, offline);
    }

    var historySig = (offline ? 'offline' : 'online') + '|';
    for (var h = 0; h < history.length; h++) historySig += history[h].slug + ':' + history[h].status + '|';
    if (historySig !== dlPrevHistorySig) {
      dlPrevHistorySig = historySig;
      dlRenderHistory(view, history, offline);
    }

    var busySig = (offline ? 'offline' : 'online') + '|';
    for (var b = 0; b < queued.length; b++) busySig += queued[b].slug + '|';
    for (var r = 0; r < running.length; r++) busySig += running[r].slug + '|';
    if (busySig !== dlPrevBusySig) {
      dlPrevBusySig = busySig;
      dlRenderRoutes(view, offline);
      dlRenderCourses(view, offline);
    }

    dlUpdateNotice(view);
    dlUpdateRefresh(view, offline, items);
    dlAnnounce(view, items, offline);
    if (focusKey) dlRestoreFocus(focusKey);
  }

  function dlRefreshState(view) {
    if (!view || dlBusy || !dlHasServer()) return;
    dlApi('/state').then(function (data) {
      dlApplyState(view, data);
    }).catch(function () {
      dlOffline = true;
      dlApplyState(view, null);
    });
  }

  function dlStartPolling(view) {
    if (dlTimer) window.clearInterval(dlTimer);
    dlTimer = window.setInterval(function () {
      if (document.hidden) return;
      dlRefreshState(view);
    }, DL_POLL_MS);
  }

  function stopDownloadsPolling() {
    if (dlTimer) { window.clearInterval(dlTimer); dlTimer = null; }
    dlView = null;
    dlBusy = false;
  }

  function dlAction(path, body) {
    if (!dlView || !dlHasServer() || dlOffline || dlBusy) return;
    dlBusy = true;
    dlApi(path, body).then(function (data) {
      dlBusy = false;
      dlNotice = '';
      dlNoticeReload = false;
      dlApplyState(dlView, data);
    }).catch(function (err) {
      dlBusy = false;
      dlNotice = (err && err.message) ? err.message : 'No se pudo completar la acción.';
      dlNoticeReload = false;
      dlApplyState(dlView, dlState);
    });
  }

  function dlRefreshCatalog() {
    if (!dlView || !dlHasServer() || dlOffline || dlBusy) return;
    dlBusy = true;
    dlApi('/refresh', {}).then(function (data) {
      dlBusy = false;
      dlNotice = 'Actualizando el catálogo…';
      dlNoticeReload = false;
      dlApplyState(dlView, data);
    }).catch(function (err) {
      dlBusy = false;
      dlNotice = (err && err.message) ? err.message : 'No se pudo actualizar el catálogo.';
      dlNoticeReload = false;
      dlApplyState(dlView, dlState);
    });
  }

  function initDescargas(view) {
    view.addEventListener('click', function (e) {
      var btn = (e.target && e.target.closest) ? e.target.closest('button') : null;
      if (!btn || !view.contains(btn) || btn.disabled) return;
      var action = btn.getAttribute('data-action');
      var control = btn.getAttribute('data-control');
      var slug = btn.getAttribute('data-slug');
      var routeId = btn.getAttribute('data-route');
      var i;

      if (control === 'refresh') { dlRefreshCatalog(); return; }
      if (control === 'reload') { window.location.reload(); return; }
      if (control === 'go-add') { dlGoAdd(view); return; }
      if (control === 'go-routes') { dlGoRoutes(view); return; }
      if (control === 'cancel-active') {
        var running = dlItemsByStatus('running');
        if (running.length) dlAction('/cancel', { slug: running[0].slug });
        return;
      }
      if (control === 'clear-history') { dlAction('/clear', {}); return; }
      if (control === 'check-session') {
        if (!dlView || !dlHasServer() || dlBusy) return;
        dlBusy = true;
        dlApi('/session/check', {}).then(function (data) {
          dlBusy = false;
          if (data && data.session) {
            if (dlState) dlState.session = data.session;
            dlApplyState(dlView, dlState);
          } else {
            dlRefreshState(dlView);
          }
        }).catch(function (err) {
          dlBusy = false;
          dlNotice = (err && err.message) ? err.message : 'No se pudo comprobar la sesión.';
          dlNoticeReload = false;
          dlApplyState(dlView, dlState);
        });
        return;
      }
      if (control === 'route-download') {
        var route = routeId ? byRouteId[routeId] : null;
        if (!route) return;
        var pending = dlRoutePending(route);
        if (!pending.length) return;
        var items = [];
        for (i = 0; i < pending.length; i++) {
          items.push({ slug: pending[i].slug, title: pending[i].title || pending[i].slug });
        }
        dlAction('/enqueue', { items: items, position: 'back' });
        return;
      }
      if (action === 'up' || action === 'down') {
        dlAction('/reorder', { slug: slug, direction: action });
        return;
      }
      if (action === 'cancel') { dlAction('/cancel', { slug: slug }); return; }
      if (action === 'add' || action === 'front') {
        var course = slug ? bySlug[slug] : null;
        if (!course) return;
        dlAction('/enqueue', {
          items: [{ slug: course.slug, title: course.title || course.slug }],
          position: action === 'front' ? 'front' : 'back'
        });
        return;
      }
      if (action === 'retry') {
        var retryCourse = slug ? bySlug[slug] : null;
        if (!retryCourse) return;
        dlAction('/enqueue', {
          items: [{ slug: retryCourse.slug, title: retryCourse.title || retryCourse.slug }],
          position: 'back'
        });
        return;
      }
      if (action === 'remove') { dlAction('/remove', { slug: slug }); return; }
    });

    var search = view.querySelector('[data-control="search"]');
    if (search) {
      search.value = '';
      search.addEventListener('input', function () {
        dlQuery = search.value || '';
        dlRenderCourses(view, dlOffline);
      });
    }
  }

  function renderDescargas() {
    setTitle('Descargas · Platzi Local');
    renderShell('descargas');
    stopDownloadsPolling();
    dlQuery = '';
    dlNotice = '';
    dlNoticeReload = false;
    dlPrevStatus = null;
    dlPrevBusySig = null;
    dlPrevQueueSig = null;
    dlPrevHistorySig = null;
    dlPrevRefreshing = !!(dlState && dlState.catalog && dlState.catalog.refreshing);
    dlOffline = !dlHasServer();
    mount('tpl-descargas', function (view) {
      dlView = view;
      initDescargas(view);
      if (!dlHasServer()) {
        dlApplyState(view, null);
        return;
      }
      if (dlState) dlApplyState(view, dlState);
      dlRefreshState(view);
      dlStartPolling(view);
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
    stopDownloadsPolling();
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
    if (seg === 'explorar') { renderExplorar(); return; }
    if (seg === 'cursos') { renderCursos(); return; }
    if (seg === 'descargas') { renderDescargas(); return; }
    if (seg === 'ruta') {
      var rid = decodeSeg(parts[1] || '');
      var route = rid ? byRouteId[rid] : null;
      if (!route) { redirectTo('#/'); return; }
      renderRuta(route); return;
    }
    if (seg === 'ruta-publica') {
      var publicRid = decodeSeg(parts[1] || '');
      if (!publicRid) { redirectTo('#/explorar'); return; }
      if (!publicCatalogAvailable) fetchPublicCatalog(function(_data,error){if(error)redirectTo('#/explorar');else renderPublicRuta(publicRid);});
      else renderPublicRuta(publicRid);
      return;
    }
    if (seg === 'curso') {
      var cslug = decodeSeg(parts[1] || '');
      var course = cslug ? (bySlug[cslug] || publicCourseForSlug(cslug)) : null;
      if (!course && cslug) { fetchPublicCatalog(function(){var found=publicCourseForSlug(cslug);if(found)renderCurso(found);else redirectTo('#/');});return; }
      if (!course) { redirectTo('#/'); return; }
      renderCurso(course); return;
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
    fetchPublicCatalog();
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

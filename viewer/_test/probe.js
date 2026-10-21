/* _test/probe.js — sonda del sandbox (no forma parte del visor). */
(function () {
  'use strict';

  var MODE = window.PROBE_MODE || 'main';
  var report = { mode: MODE, errors: [], warnings: [], steps: [] };

  window.addEventListener('error', function (e) {
    report.errors.push('js: ' + (e.message || 'evento error') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    report.errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason));
  });
  var origError = console.error;
  console.error = function () {
    report.errors.push('console.error: ' + Array.prototype.join.call(arguments, ' '));
    origError.apply(console, arguments);
  };
  var origWarn = console.warn;
  console.warn = function () {
    report.warnings.push(Array.prototype.join.call(arguments, ' '));
    origWarn.apply(console, arguments);
  };

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function txt(el) { return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null; }
  function attr(el, a) { return el ? el.getAttribute(a) : null; }
  function vis(el) { return !!el && !el.hidden; }
  function readStore() {
    try { return JSON.parse(window.localStorage.getItem('platziLocal.v1') || 'null'); } catch (e) { return 'THROWS'; }
  }
  function rec(name, data) { report.steps.push({ name: name, data: data }); return data; }
  function go(hash) { window.location.hash = hash; }
  function pressKey(el, key) {
    (el || document).dispatchEvent(new KeyboardEvent('keydown', { key: key, bubbles: true, cancelable: true }));
  }
  function fire(el, type) { if (el) el.dispatchEvent(new Event(type, { bubbles: false })); }
  function setSelect(sel, value) {
    if (!sel) return;
    sel.value = value;
    fire(sel, 'change');
  }

  var steps = [];
  function step(name, fn, wait) { steps.push({ name: name, fn: fn, wait: wait == null ? 160 : wait }); }

  function runSteps() {
    var i = 0;
    (function next() {
      if (i >= steps.length) return finish();
      var s = steps[i++];
      try { s.fn(); } catch (e) { report.errors.push('step ' + s.name + ': ' + ((e && e.message) || e)); }
      window.setTimeout(next, s.wait);
    })();
  }

  function finish() {
    report.missingHooks = window.PLATZI_MISSING_HOOKS || [];
    var pre = document.createElement('pre');
    pre.id = 'probe-out';
    pre.textContent = 'PROBE_JSON::' + JSON.stringify(report);
    document.body.appendChild(pre);
    document.title = 'PROBE_DONE';
    window.__probeReport = JSON.stringify(report);
    window.__probeDone = true;
  }

  function media() { return $('#player'); }
  function mediaOK() { var v = media(); return !!v && v.readyState >= 1; }

  var C = window.PLATZI_LOCAL || null;
  var cc = null, ccFlat = [];
  if (C && C.courses) {
    for (var i = 0; i < C.courses.length; i++) {
      if (C.courses[i].slug === 'claude-code') cc = C.courses[i];
    }
    if (cc) cc.modules.forEach(function (m) { m.classes.forEach(function (f) { ccFlat.push(f); }); });
  }
  var seedSrc = (cc && cc.modules[0] && cc.modules[0].classes[0]) ? cc.modules[0].classes[0].src : null;

  /* ---------------- modo nodata ---------------- */

  if (MODE === 'nodata') {
    step('nodata-boot', function () {
      rec('nodata', {
        title: document.title,
        appText: txt($('#app')),
        appChildren: $('#app') ? $('#app').children.length : -1,
        chipHidden: $('#resume-chip') ? $('#resume-chip').hidden : null,
        searchExists: !!$('#search-input')
      });
    }, 300);
    step('nodata-routes', function () { go('#/rutas'); }, 250);
    step('nodata-after-ruta', function () {
      rec('nodata-nav', { hash: location.hash, appText: txt($('#app')) });
    }, 200);
  } else if (MODE === 'nostorage') {
    step('nostorage-boot', function () {
      var notice = $('[data-notice]');
      rec('nostorage', {
        title: document.title,
        noticeExists: !!notice,
        noticeText: txt(notice),
        noticeHidden: notice ? notice.hidden : null,
        appChildren: $('#app') ? $('#app').children.length : -1,
        homeCourses: $$('[data-list="courses"] .course-card').length,
        chipHidden: $('#resume-chip') ? $('#resume-chip').hidden : null
      });
    }, 300);
    step('nostorage-course', function () { go('#/curso/claude-code'); }, 300);
    step('nostorage-mark', function () {
      var mark = $('[data-control="mark"]');
      var rows = $$('[data-list="classes"] .class-row');
      var firstLink = rows.length ? $('a', rows[0]) : null;
      rec('nostorage-course', { hash: location.hash, rows: rows.length });
      if (firstLink) { go(firstLink.getAttribute('href')); }
      void mark;
    }, 400);
    step('nostorage-toggle-memory', function () {
      var mark = $('[data-control="mark"]');
      var before = txt($('[data-slot="mark-label"]'));
      if (mark) mark.click();
      rec('nostorage-mark', {
        labelBefore: before,
        labelAfter: txt($('[data-slot="mark-label"]')),
        store: readStore(),
        hash: location.hash
      });
    }, 250);
  } else {
    /* ---------------- modo main ---------------- */

    step('boot', function () {
      var chip = $('#resume-chip');
      rec('boot', {
        title: document.title,
        appChildren: $('#app') ? $('#app').children.length : -1,
        chipHidden: chip ? chip.hidden : null,
        chipText: txt(chip),
        resumeEmptyVisible: vis($('[data-slot="resume-empty"]')),
        resumeTitle: txt($('[data-slot="resume-title"]')),
        resumeMeta: txt($('[data-slot="resume-meta"]')),
        resumeHref: attr($('a[data-slot="resume-link"]'), 'href'),
        homeRoutes: $$('[data-list="routes"] .route-card').length,
        homeRouteOrder: $$('[data-list="routes"] .route-card [data-slot="title"]').map(txt),
        homeCourses: $$('[data-list="courses"] .course-card').length,
        firstCards: $$('[data-list="courses"] .course-card').slice(0, 3).map(function (c) {
          return { state: attr(c, 'data-state'), title: txt($('[data-slot="title"]', c)), meta: txt($('[data-slot="meta"]', c)), chips: $$('.chip', c).map(txt), bar: attr($('[data-slot="bar"]', c), 'style') };
        }),
        bannerHidden: $('#banner-file') ? $('#banner-file').hidden : null,
        navCurrent: (function () { var a = $('a[data-nav][aria-current="page"]'); return a ? attr(a, 'data-nav') : null; })()
      });
    }, 350);

    step('rutas', function () { go('#/rutas'); }, 260);
    step('rutas-read', function () {
      var cards = $$('[data-list="routes"] .route-card');
      var first = cards[0];
      rec('rutas', {
        title: document.title,
        count: cards.length,
        order: $$('[data-slot="title"]', $('[data-list="routes"]')).map(txt),
        first: first ? {
          title: txt($('[data-slot="title"]', first)),
          meta: txt($('[data-slot="meta"]', first)),
          pct: txt($('[data-slot="pct"]', first)),
          href: attr(first, 'href'),
          bar: attr($('[data-slot="bar"]', first), 'style')
        } : null,
        emptyHidden: $('[data-slot="empty"]') ? $('[data-slot="empty"]').hidden : null,
        navCurrent: (function () { var a = $('a[data-nav][aria-current="page"]'); return a ? attr(a, 'data-nav') : null; })()
      });
    }, 220);

    step('ruta-detalle', function () { go('#/ruta/desarrollo-web'); }, 300);
    step('ruta-read', function () {
      var view = $('.view-ruta');
      rec('ruta', {
        title: document.title,
        h1: txt($('[data-slot="title"]', view)),
        meta: txt($('[data-slot="meta"]', view)),
        pct: txt($('[data-slot="pct"]', view)),
        bar: attr($('[data-slot="bar"]', view), 'style'),
        continueHref: attr($('a[data-slot="continue"]', view), 'href'),
        continueHidden: $('a[data-slot="continue"]', view) ? $('a[data-slot="continue"]', view).hidden : null,
        courses: $$('[data-list="courses"] .course-card').length,
        order: $$('[data-slot="title"]', $('[data-list="courses"]')).map(txt)
      });
    }, 220);

    step('ruta-invalida', function () { go('#/ruta/no-existe'); }, 300);
    step('ruta-invalida-read', function () { rec('redirectRuta', { hash: location.hash, title: document.title }); }, 150);

    step('cursos', function () { go('#/cursos'); }, 300);
    step('cursos-read', function () {
      var cards = $$('[data-list="courses"] .course-card');
      rec('cursos', {
        title: document.title,
        count: txt($('[data-slot="count"]')),
        cards: cards.length,
        order: $$('[data-slot="title"]', $('[data-list="courses"]')).map(txt),
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); }),
        filterCounts: $$('[data-filter-count]').map(function (s) { return attr(s, 'data-filter-count') + '=' + txt(s); })
      });
    }, 220);

    step('filtro-queued', function () {
      var b = $('[data-filter="queued"]');
      if (b) b.click();
    }, 250);
    step('filtro-queued-read', function () {
      rec('filtroQueued', {
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('filtro-missing', function () { var b = $('[data-filter="missing"]'); if (b) b.click(); }, 220);
    step('filtro-missing-read', function () {
      rec('filtroMissing', {
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('filtro-progress', function () { var b = $('[data-filter="progress"]'); if (b) b.click(); }, 220);
    step('filtro-progress-read', function () {
      rec('filtroProgress', {
        count: txt($('[data-slot="count"]')),
        titles: $$('[data-slot="title"]', $('[data-list="courses"]')).map(txt),
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('filtro-cert', function () { var b = $('[data-filter="cert"]'); if (b) b.click(); }, 220);
    step('filtro-cert-read', function () {
      var empty = $('[data-slot="empty"]');
      rec('filtroCert', {
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        empty: txt(empty),
        emptyHidden: empty ? empty.hidden : null,
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('filtro-all', function () { var b = $('[data-filter="all"]'); if (b) b.click(); }, 220);
    step('filtro-all-read', function () {
      rec('filtroAll', { count: txt($('[data-slot="count"]')), cards: $$('[data-list="courses"] .course-card').length });
    }, 180);

    step('ruta-filtros', function () { go('#/ruta/desarrollo-web'); }, 300);
    step('ruta-filtros-read', function () {
      rec('rutaFiltros', {
        title: document.title,
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        filterCounts: $$('[data-filter-count]').map(function (s) { return attr(s, 'data-filter-count') + '=' + txt(s); }),
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 200);

    step('ruta-filtro-progress', function () { var b = $('[data-filter="progress"]'); if (b) b.click(); }, 220);
    step('ruta-filtro-progress-read', function () {
      rec('rutaFiltroProgress', {
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('ruta-filtro-missing', function () { var b = $('[data-filter="missing"]'); if (b) b.click(); }, 220);
    step('ruta-filtro-missing-read', function () {
      var empty = $('[data-slot="empty"]');
      rec('rutaFiltroMissing', {
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        empty: txt(empty),
        emptyHidden: empty ? empty.hidden : null,
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('ruta-filtro-all', function () { var b = $('[data-filter="all"]'); if (b) b.click(); }, 220);
    step('ruta-filtro-all-read', function () {
      rec('rutaFiltroAll', {
        count: txt($('[data-slot="count"]')),
        cards: $$('[data-list="courses"] .course-card').length,
        pressed: $$('[data-filter]').map(function (b) { return attr(b, 'data-filter') + '=' + attr(b, 'aria-pressed'); })
      });
    }, 180);

    step('curso-claude', function () { go('#/curso/claude-code'); }, 350);
    step('curso-claude-read', function () {
      var view = $('.view-curso');
      var mods = $$('[data-list="modules"] details.module');
      var rows = $$('[data-list="classes"] .class-row');
      var doneRow = null, currentRow = null;
      rows.forEach(function (r) { if (attr(r, 'data-done') === 'true') doneRow = r; if (attr(r, 'data-current') === 'true') currentRow = r; });
      rec('cursoClaude', {
        title: document.title,
        h1: txt($('[data-slot="title"]', view)),
        chips: $$('.chip', $('[data-slot="chips"]', view)).map(txt),
        progressText: txt($('[data-slot="progress-text"]', view)),
        progressHidden: $('[data-slot="progress-text"]', view) ? $('[data-slot="progress-text"]', view).hidden : null,
        bar: attr($('[data-slot="bar"]', view), 'style'),
        continueHref: attr($('a[data-slot="continue"]', view), 'href'),
        continueLabel: txt($('[data-slot="continue-label"]', view)),
        continueDisabled: attr($('a[data-slot="continue"]', view), 'aria-disabled'),
        platzi: txt($('[data-slot="platzi"]', view)),
        platziHidden: $('[data-slot="platzi"]', view) ? $('[data-slot="platzi"]', view).hidden : null,
        platziLinkHidden: $('a[data-slot="platzi-link"]', view) ? $('a[data-slot="platzi-link"]', view).hidden : null,
        platziLinkHref: attr($('a[data-slot="platzi-link"]', view), 'href'),
        platziLinkText: txt($('a[data-slot="platzi-link"]', view)),
        diplomaHidden: $('a[data-slot="diploma"]', view) ? $('a[data-slot="diploma"]', view).hidden : null,
        emptyHidden: $('[data-slot="empty"]', view) ? $('[data-slot="empty"]', view).hidden : null,
        moduleCount: mods.length,
        modulesOpen: mods.map(function (d) { return d.open; }),
        moduleCounts: mods.map(function (d) { return txt($('[data-slot="count"]', d)); }),
        rowTotal: rows.length,
        doneRow: doneRow ? { title: txt($('[data-slot="title"]', doneRow)), icon: attr($('use', doneRow), 'href'), time: txt($('[data-slot="time"]', doneRow)) } : null,
        currentRow: currentRow ? { title: txt($('[data-slot="title"]', currentRow)), aria: attr($('a', currentRow), 'aria-current'), bar: attr($('[data-slot="bar"]', currentRow), 'style') } : null
      });
    }, 220);

    step('curso-owasp', function () { go('#/curso/owasp'); }, 320);
    step('curso-owasp-read', function () {
      var view = $('.view-curso');
      var bar = $('[data-slot="bar"]', view);
      rec('cursoOwasp', {
        chips: $$('.chip', $('[data-slot="chips"]', view)).map(txt),
        emptyVisible: vis($('[data-slot="empty"]', view)),
        emptyText: txt($('[data-slot="empty"]', view)),
        modulesHidden: $('[data-list="modules"]', view) ? $('[data-list="modules"]', view).hidden : null,
        continueHref: attr($('a[data-slot="continue"]', view), 'href'),
        continueDisabled: attr($('a[data-slot="continue"]', view), 'aria-disabled'),
        continueAttrDisabled: attr($('a[data-slot="continue"]', view), 'disabled'),
        progressbarHidden: bar && bar.parentElement ? bar.parentElement.hidden : null,
        progressTextHidden: $('[data-slot="progress-text"]', view) ? $('[data-slot="progress-text"]', view).hidden : null,
        platziHidden: $('[data-slot="platzi"]', view) ? $('[data-slot="platzi"]', view).hidden : null,
        platziLinkHidden: $('a[data-slot="platzi-link"]', view) ? $('a[data-slot="platzi-link"]', view).hidden : null,
        platziLinkHref: attr($('a[data-slot="platzi-link"]', view), 'href')
      });
    }, 200);

    step('curso-nulos', function () { go('#/curso/nulos'); }, 300);
    step('curso-nulos-read', function () {
      var view = $('.view-curso');
      rec('cursoNulos', {
        h1: txt($('[data-slot="title"]', view)),
        meta: txt($('[data-slot="meta"]', $('[data-list="courses"] .course-card'))),
        cardMeta: txt($('[data-slot="meta"]', $('[data-list="courses"] .course-card'))),
        platziHidden: $('[data-slot="platzi"]', view) ? $('[data-slot="platzi"]', view).hidden : null,
        moduleName: txt($('[data-slot="name"]', view)),
        classTime: txt($('[data-slot="time"]', view)),
        chips: $$('.chip', $('[data-slot="chips"]', view)).map(txt)
      });
    }, 200);

    step('curso-error', function () { go('#/curso/no-existe'); }, 300);
    step('curso-error-read', function () { rec('redirectCurso', { hash: location.hash }); }, 150);

    step('buscar-acento', function () { go('#/buscar/ingles'); }, 320);
    step('buscar-acento-read', function () {
      var view = $('.view-buscar');
      rec('buscarIngles', {
        title: document.title,
        q: txt($('[data-slot="q"]', view)),
        courses: $$('[data-list="courses"] .course-card').length,
        courseTitles: $$('[data-slot="title"]', $('[data-list="courses"]')).map(txt),
        classes: $$('[data-list="classes"] .result-class').length,
        classesHidden: $('[data-list="classes"]', view) ? $('[data-list="classes"]', view).hidden : null,
        emptyHidden: $('[data-slot="empty"]', view) ? $('[data-slot="empty"]', view).hidden : null
      });
    }, 200);

    step('buscar-clases', function () { go('#/buscar/claude'); }, 320);
    step('buscar-clases-read', function () {
      var view = $('.view-buscar');
      var first = $('[data-list="classes"] .result-class');
      rec('buscarClaude', {
        courses: $$('[data-list="courses"] .course-card').length,
        classes: $$('[data-list="classes"] .result-class').length,
        first: first ? {
          title: txt($('[data-slot="title"]', first)),
          course: txt($('[data-slot="course"]', first)),
          time: txt($('[data-slot="time"]', first)),
          href: attr($('a', first), 'href')
        } : null
      });
    }, 200);

    step('buscar-vacio', function () { go('#/buscar/zzzz'); }, 320);
    step('buscar-vacio-read', function () {
      var view = $('.view-buscar');
      rec('buscarVacio', {
        emptyVisible: vis($('[data-slot="empty"]', view)),
        emptyText: txt($('[data-slot="empty"]', view)),
        coursesHidden: $('[data-list="courses"]', view) ? $('[data-list="courses"]', view).hidden : null,
        classesHidden: $('[data-list="classes"]', view) ? $('[data-list="classes"]', view).hidden : null
      });
    }, 200);

    step('dropdown', function () {
      go('#/');
      var input = $('#search-input');
      if (input) {
        input.value = 'claude';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 320);
    step('dropdown-read', function () {
      var box = $('#search-results');
      var items = box ? $$(':scope > *', box) : [];
      rec('dropdown', {
        boxHidden: box ? box.hidden : null,
        items: items.length,
        kinds: items.map(function (n) { return attr(n, 'data-kind'); }),
        titles: items.map(function (n) { return txt($('[data-slot="title"]', n)); }),
        expanded: attr($('#search-input'), 'aria-expanded')
      });
    }, 200);
    step('dropdown-keys', function () {
      pressKey($('#search-input'), 'ArrowDown');
      pressKey($('#search-input'), 'ArrowDown');
      pressKey($('#search-input'), 'ArrowUp');
    }, 200);
    step('dropdown-keys-read', function () {
      var box = $('#search-results');
      rec('dropdownKeys', {
        activedescendant: attr($('#search-input'), 'aria-activedescendant'),
        active: box ? $$('[data-active="true"]', box).length : null,
        selected: box ? $$('[aria-selected="true"]', box).length : null
      });
    }, 180);
    step('dropdown-enter', function () { pressKey($('#search-input'), 'Enter'); }, 320);
    step('dropdown-enter-read', function () {
      rec('dropdownEnter', { hash: location.hash, boxHidden: $('#search-results') ? $('#search-results').hidden : null, title: document.title });
    }, 150);
    step('dropdown-escape', function () {
      go('#/');
      var input = $('#search-input');
      if (input) {
        input.value = 'claude';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, 300);
    step('dropdown-escape-press', function () {
      pressKey($('#search-input'), 'Escape');
    }, 200);
    step('dropdown-escape-read', function () {
      rec('dropdownEscape', { boxHidden: $('#search-results') ? $('#search-results').hidden : null, inputValue: $('#search-input') ? $('#search-input').value : null });
    }, 150);

    step('aula-seeded', function () { go('#/aula/claude-code/1'); }, 2600);
    step('aula-read', function () {
      var v = media();
      var rows = $$('[data-list="classes"] .class-row');
      var currentRow = null;
      rows.forEach(function (r) { if (attr(r, 'data-current') === 'true') currentRow = r; });
      var tracks = v ? Array.prototype.map.call(v.textTracks, function (t) { return { lang: t.language, mode: t.mode }; }) : null;
      rec('aula', {
        title: document.title,
        classTitle: txt($('[data-slot="class-title"]')),
        moduleName: txt($('[data-slot="module-name"]')),
        courseLink: { text: txt($('[data-slot="course-link"]')), href: attr($('[data-slot="course-link"]'), 'href') },
        progressText: txt($('[data-slot="progress-text"]')),
        prevDisabled: $('[data-control="prev"]') ? $('[data-control="prev"]').disabled : null,
        nextDisabled: $('[data-control="next"]') ? $('[data-control="next"]').disabled : null,
        markLabel: txt($('[data-slot="mark-label"]')),
        markPressed: attr($('[data-control="mark"]'), 'aria-pressed'),
        errorVisible: vis($('[data-slot="error"]')),
        speedSelect: $('#player') && $('select[data-control="speed"]') ? $('select[data-control="speed"]').value : null,
        captionsSelect: $('select[data-control="captions"]') ? $('select[data-control="captions"]').value : null,
        autoplayChecked: $('input[data-control="autoplay"]') ? $('input[data-control="autoplay"]').checked : null,
        playlist: rows.length,
        currentRowIndex: currentRow ? rows.indexOf(currentRow) : null,
        currentAria: currentRow ? attr($('a', currentRow), 'aria-current') : null,
        video: v ? {
          readyState: v.readyState,
          duration: v.duration,
          currentTime: Math.round(v.currentTime * 10) / 10,
          playbackRate: v.playbackRate,
          volume: v.volume,
          muted: v.muted,
          sources: $$('source', v).map(function (s) { return attr(s, 'src'); }),
          tracks: $$('track', v).map(function (t) { return attr(t, 'srclang') + ':' + attr(t, 'label') + ':' + attr(t, 'src'); }),
          trackModes: tracks,
          error: v.error ? v.error.code : null
        } : null
      });
    }, 200);

    step('aula-mark', function () {
      var mark = $('[data-control="mark"]');
      if (mark) mark.click();
      rec('aulaMarkOn', {
        label: txt($('[data-slot="mark-label"]')),
        pressed: attr(mark, 'aria-pressed'),
        done: seedSrc && readStore().watched ? readStore().watched['claude-code|' + seedSrc].done : null
      });
    }, 250);
    step('aula-mark-off', function () {
      var mark = $('[data-control="mark"]');
      if (mark) mark.click();
      rec('aulaMarkOff', {
        label: txt($('[data-slot="mark-label"]')),
        pressed: attr(mark, 'aria-pressed'),
        done: seedSrc && readStore().watched ? readStore().watched['claude-code|' + seedSrc].done : null
      });
    }, 250);

    step('aula-save-pause', function () {
      if (!mediaOK()) { rec('aulaSavePause', 'SKIP readyState=' + (media() ? media().readyState : 'sin video')); return; }
      var v = media();
      v.currentTime = 123;
      fire(v, 'pause');
      var st = readStore();
      rec('aulaSavePause', { pos: st.watched['claude-code|' + seedSrc].pos, lastSrc: st.last && st.last.src === seedSrc });
    }, 250);

    step('aula-save-tick', function () {
      if (!mediaOK()) { rec('aulaSaveTick', 'SKIP'); return; }
      var v = media();
      v.currentTime = 140;
      fire(v, 'timeupdate');
      var st = readStore();
      rec('aulaSaveTick', { pos: st.watched['claude-code|' + seedSrc].pos });
    }, 250);

    step('aula-speed', function () {
      setSelect($('select[data-control="speed"]'), '2');
      var st = readStore();
      rec('aulaSpeed', { playbackRate: media() ? media().playbackRate : null, pref: st.prefs.speed, select: $('select[data-control="speed"]').value });
    }, 250);

    step('aula-captions', function () {
      setSelect($('select[data-control="captions"]'), 'en');
      var v = media();
      rec('aulaCaptions', {
        pref: readStore().prefs.captions,
        modes: v ? Array.prototype.map.call(v.textTracks, function (t) { return t.language + '=' + t.mode; }) : null
      });
    }, 250);

    step('aula-keys', function () {
      if (!mediaOK()) { rec('aulaKeys', 'SKIP'); return; }
      var v = media();
      var t0 = v.currentTime;
      pressKey(document, 'ArrowRight');
      var t1 = v.currentTime;
      pressKey(document, 'j');
      var t2 = v.currentTime;
      pressKey(document, 'l');
      var t3 = v.currentTime;
      pressKey(document, 'ArrowDown');
      var vol = v.volume;
      pressKey(document, 'm');
      var muted = v.muted;
      pressKey(document, 'c');
      rec('aulaKeys', {
        right: Math.round((t1 - t0) * 10) / 10,
        j: Math.round((t2 - t1) * 10) / 10,
        l: Math.round((t3 - t2) * 10) / 10,
        volume: Math.round(vol * 100) / 100,
        muted: muted,
        captionsAfterC: readStore().prefs.captions,
        modeAfterC: Array.prototype.map.call(v.textTracks, function (t) { return t.language + '=' + t.mode; })
      });
    }, 250);

    step('aula-input-guard', function () {
      if (!mediaOK()) { rec('aulaGuard', 'SKIP'); return; }
      var v = media();
      var t0 = v.currentTime;
      pressKey($('#search-input'), 'ArrowRight');
      rec('aulaGuard', { delta: Math.round((v.currentTime - t0) * 10) / 10 });
    }, 200);

    step('aula-autoplay-check', function () {
      var cb = $('input[data-control="autoplay"]');
      if (cb) { cb.checked = true; fire(cb, 'change'); }
      rec('aulaAutoplay', { pref: readStore().prefs.autoplayNext, checked: cb ? cb.checked : null });
    }, 200);

    step('aula-next-btn', function () {
      var next = $('[data-control="next"]');
      if (next) next.click();
    }, 500);
    step('aula-next-read', function () {
      rec('aulaNext', { hash: location.hash, classTitle: txt($('[data-slot="class-title"]')), prevDisabled: $('[data-control="prev"]').disabled });
    }, 200);

    step('aula-clamp', function () { go('#/aula/claude-code/999'); }, 700);
    step('aula-clamp-read', function () {
      rec('aulaClamp', {
        hash: location.hash,
        classTitle: txt($('[data-slot="class-title"]')),
        lastTitle: ccFlat.length ? ccFlat[ccFlat.length - 1].title : null,
        nextDisabled: $('[data-control="next"]') ? $('[data-control="next"]').disabled : null,
        prevDisabled: $('[data-control="prev"]') ? $('[data-control="prev"]').disabled : null
      });
    }, 200);

    step('aula-n-invalida', function () { go('#/aula/claude-code/abc'); }, 700);
    step('aula-n-invalida-read', function () {
      rec('aulaNInvalida', { hash: location.hash, classTitle: txt($('[data-slot="class-title"]')), firstTitle: ccFlat.length ? ccFlat[0].title : null });
    }, 200);

    step('aula-owasp', function () { go('#/aula/owasp/1'); }, 500);
    step('aula-owasp-read', function () { rec('aulaOwasp', { hash: location.hash, title: document.title }); }, 150);

    step('aula-video-404', function () { go('#/aula/roto/1'); }, 1800);
    step('aula-video-404-read', function () {
      var err = $('[data-slot="error"]');
      rec('aulaRoto', {
        errorVisible: vis(err),
        errorText: txt(err),
        autoplayDisabled: $('input[data-control="autoplay"]') ? $('input[data-control="autoplay"]').checked === false && $('input[data-control="autoplay"]').disabled === true : null,
        classTitle: txt($('[data-slot="class-title"]'))
      });
    }, 200);

    step('ended-unmarked', function () { go('#/aula/claude-code/5'); }, 900);
    step('ended-unmarked-mark', function () {
      var mark = $('[data-control="mark"]');
      if (mark) { mark.click(); mark.click(); }
    }, 400);
    step('ended-unmarked-mark-read', function () {
      var st = readStore();
      var e = (ccFlat[4] && st && st.watched) ? st.watched['claude-code|' + ccFlat[4].src] : null;
      rec('endedPre', {
        label: txt($('[data-slot="mark-label"]')),
        src: ccFlat[4] ? ccFlat[4].src : null,
        done: e ? e.done : null
      });
    }, 200);
    step('ended-unmarked-fire', function () {
      var v = media();
      if (v) fire(v, 'ended');
    }, 600);
    step('ended-unmarked-read', function () {
      var st = readStore();
      rec('endedUnmarked', {
        hash: location.hash,
        done: ccFlat[4] ? st.watched['claude-code|' + ccFlat[4].src].done : null
      });
    }, 200);

    step('ended-autoplay', function () {
      var v = media();
      if (v) fire(v, 'ended');
    }, 600);
    step('ended-autoplay-read', function () {
      var st = readStore();
      rec('endedAutoplay', {
        hash: location.hash,
        previousDone: ccFlat[5] ? st.watched['claude-code|' + ccFlat[5].src].done : null,
        label: txt($('[data-slot="mark-label"]'))
      });
    }, 200);

    step('flush', function () {
      if (!mediaOK()) { rec('flush', 'SKIP'); return; }
      var v = media();
      v.currentTime = 55;
      window.dispatchEvent(new Event('beforeunload'));
      var st = readStore();
      var cur = null;
      if (ccFlat[6]) cur = st.watched['claude-code|' + ccFlat[6].src];
      rec('flush', { pos: cur ? cur.pos : null, hash: location.hash });
    }, 200);

    step('home-final', function () { go('#/'); }, 400);
    step('home-final-read', function () {
      rec('homeFinal', {
        chipHidden: $('#resume-chip') ? $('#resume-chip').hidden : null,
        chipText: txt($('#resume-chip')),
        resumeTitle: txt($('[data-slot="resume-title"]')),
        resumeMeta: txt($('[data-slot="resume-meta"]')),
        homeCourses: $$('[data-list="courses"] .course-card').length
      });
    }, 200);
  }

  window.addEventListener('load', function () { window.setTimeout(runSteps, 250); });
})();

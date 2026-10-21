// Genera _test/data.js con cursos de mentira que apuntan a mp4/vtt reales de Courses/.
// Solo para probar viewer/app.js en _test/ (no forma parte del visor).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const outFile = path.join(__dirname, 'data.js');

function readDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch (e) { return []; }
}

function cleanTitle(base) {
  return base.replace(/^\d+[-–]\s*/, '').replace(/_/g, ' ').trim();
}

// prefijo relativo de _test/ hacia la raíz del proyecto para el src de cada clase
function courseFrom(folder, options) {
  options = options || {};
  const folderPath = path.join(root, 'Courses', folder);
  const relBase = '../../Courses/' + folder;
  const mods = [];
  let flat = 0;
  const modDirs = readDir(folderPath).filter(function (d) { return d.isDirectory(); })
    .map(function (d) { return d.name; })
    .sort(function (a, b) { return a.localeCompare(b, 'es'); });
  const useMods = options.modules == null ? modDirs : modDirs.slice(0, options.modules);
  useMods.forEach(function (modName, mi) {
    const modPath = path.join(folderPath, modName);
    let files = readDir(modPath).filter(function (f) { return f.isFile() && /\.mp4$/i.test(f.name); })
      .map(function (f) { return f.name; })
      .sort(function (a, b) { return a.localeCompare(b, 'es'); });
    if (options.classesPerModule) files = files.slice(0, options.classesPerModule);
    const classes = files.map(function (file, ci) {
      const base = file.replace(/\.mp4$/i, '');
      const subs = {};
      ['es', 'en', 'pt'].forEach(function (lang) {
        const vtt = base + '_' + lang + '.vtt';
        if (fs.existsSync(path.join(modPath, vtt))) {
          subs[lang] = relBase + '/' + modName + '/' + vtt;
        }
      });
      const noMeta = options.sindatos && ci === 0;
      flat++;
      return {
        src: relBase + '/' + modName + '/' + file,
        title: cleanTitle(base),
        durationSec: noMeta ? null : (240 + (mi * 3 + ci) * 75),
        subs: Object.keys(subs).length ? subs : null
      };
    });
    mods.push({ name: options.moduleNameNull && mi === 0 ? null : modName, classes });
  });
  return { modules: mods, classes: flat };
}

const claude = courseFrom('Curso de Claude Code', {});
const ingles = courseFrom('Curso de Inglés Básico A1 para Principiantes', { modules: 1, classesPerModule: 2 });
const nulos = courseFrom('Curso de Claude Code', { modules: 2, classesPerModule: 1, sindatos: true, moduleNameNull: true });
const MT = Date.UTC(2026, 8, 28, 10, 0, 0);

const data = {
  generatedAt: '2026-10-18T12:00:00Z',
  stats: {
    courses: 5,
    downloaded: 4,
    classes: claude.classes + ingles.classes + nulos.classes,
    durationSec: 36000
  },
  routes: [
    { id: 'ai-native', title: 'AI-Native', pct: 0, hours: 57, coursesCount: 19, cover: null, courses: ['claude-code', 'owasp'] },
    { id: 'desarrollo-web', title: 'Desarrollo Web', pct: 45, hours: 44, coursesCount: 3, cover: null, courses: ['claude-code', 'nulos'] },
    { id: 'fundamentos', title: 'Fundamentos', pct: 100, hours: 12, coursesCount: 2, cover: null, courses: ['ingles-a1'] },
    { id: 'ingles', title: 'Inglés', pct: 60, hours: null, coursesCount: 1, cover: null, courses: ['ingles-a1'] }
  ],
  courses: [
    {
      slug: 'claude-code',
      url: 'https://platzi.com/cursos/claude-code/',
      title: 'Curso de Claude Code',
      folder: 'Curso de Claude Code',
      routes: ['ai-native', 'desarrollo-web'],
      hours: 2.5,
      category: 'Inteligencia Artificial',
      cert: null,
      platzi: { done: 7, total: 13, at: '2026-09-28', last: 'Revisión de seguridad' },
      cover: null,
      coverRemote: 'https://static.platzi.com/foo.jpg',
      queued: false,
      downloaded: true,
      classesTotal: 13,
      durationSec: 9420,
      modules: claude.modules
    },
    {
      slug: 'ingles-a1',
      url: 'https://platzi.com/cursos/ingles-a1/',
      title: 'Curso de Inglés Básico A1 para Principiantes',
      folder: 'Curso de Inglés Básico A1 para Principiantes',
      routes: ['fundamentos', 'ingles'],
      hours: null,
      category: 'Idiomas',
      cert: { date: '2026-08-15', url: 'https://platzi.com/p/mitxel/' },
      platzi: { done: 13, total: 13, at: '2026-08-15', last: 'Entrevista' },
      cover: 'assets/covers/ingles-a1.jpg',
      coverRemote: null,
      queued: false,
      downloaded: true,
      classesTotal: 2,
      durationSec: 7200,
      modules: ingles.modules
    },
    {
      slug: 'owasp',
      url: 'https://platzi.com/cursos/owasp/',
      title: 'Curso de OWASP Top 10 Riesgos en Aplicaciones',
      folder: null,
      routes: ['ai-native'],
      hours: 1.5,
      category: null,
      cert: null,
      platzi: { done: 3, total: 20, at: '2026-10-01', last: null },
      cover: null,
      coverRemote: null,
      queued: true,
      downloaded: false,
      classesTotal: 20,
      durationSec: null,
      modules: []
    },
    {
      slug: 'nulos',
      url: 'https://platzi.com/cursos/nulos/',
      title: 'Curso sin metadatos',
      folder: null,
      routes: ['desarrollo-web'],
      hours: null,
      category: null,
      cert: null,
      platzi: null,
      cover: null,
      coverRemote: null,
      queued: false,
      downloaded: true,
      classesTotal: null,
      durationSec: null,
      modules: nulos.modules
    },
    {
      slug: 'roto',
      url: 'https://platzi.com/cursos/roto/',
      title: 'Curso con video roto',
      folder: null,
      routes: [],
      hours: null,
      category: null,
      cert: null,
      platzi: null,
      cover: null,
      coverRemote: null,
      queued: false,
      downloaded: true,
      classesTotal: 1,
      durationSec: 300,
      modules: [{
        name: 'Módulo único',
        classes: [{ src: '../../Courses/NO-EXISTE/roto.mp4', title: 'Clase rota', durationSec: 300, subs: null }]
      }]
    }
  ]
};

fs.writeFileSync(outFile, 'window.PLATZI_LOCAL = ' + JSON.stringify(data, null, 2) + ';\n', 'utf8');
console.log('data.js escrito:', outFile);
console.log('clases:', claude.classes, ingles.classes, nulos.classes, '| first last:', MT);

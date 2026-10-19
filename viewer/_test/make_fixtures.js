// _test/make_fixtures.js — arma las copias de index.html para el sandbox (solo _test/).
const fs = require('fs');
const path = require('path');

const viewer = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(viewer, 'index.html'), 'utf8');

function shift(h, up) {
  return h
    .replace('href="assets/logo.svg"', 'href="' + up + 'assets/logo.svg"')
    .replace('href="styles.css"', 'href="' + up + 'styles.css"')
    .replace('src="app.js"', 'src="' + up + 'app.js"');
}

const tailMain = '<script src="' + '../app.js' + '" defer></script>';
const withProbe = (h, probeSrc) => h.replace(/<script src="[^"]*app\.js" defer><\/script>/,
  (m) => m + '\n<script src="' + probeSrc + '" defer></script>');

// main: data mock + seed + app + probe
let main = shift(html, '../');
main = main.replace('<title>Platzi Local</title>', '<title>Platzi Local</title>\n<script>window.PROBE_MODE = "main";</script>');
main = main.replace('<script src="data.js" defer></script>', '<script src="data.js" defer></script>\n<script src="seed.js" defer></script>');
main = withProbe(main, 'probe.js');

// nodata: sin data.js
let nodata = shift(html, '../../').replace('<script src="data.js" defer></script>', '');
nodata = nodata.replace('<title>Platzi Local</title>', '<title>Platzi Local</title>\n<script>window.PROBE_MODE = "nodata";</script>');
nodata = withProbe(nodata, '../probe.js');

// nostorage: localStorage bloqueado
const blocker = '<script>window.PROBE_MODE = "nostorage";\ntry { Object.defineProperty(window, "localStorage", { configurable: true, get: function () { throw new Error("localStorage bloqueado"); } }); } catch (e) {}</script>';
let nostorage = shift(html, '../');
nostorage = nostorage.replace('<script src="data.js" defer></script>', blocker + '\n<script src="data.js" defer></script>');
nostorage = withProbe(nostorage, 'probe.js');

fs.writeFileSync(path.join(__dirname, 'index.html'), main, 'utf8');
fs.mkdirSync(path.join(__dirname, 'nodata'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'nodata', 'index.html'), nodata, 'utf8');
fs.mkdirSync(path.join(__dirname, 'nostorage'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'nostorage', 'index.html'), nostorage, 'utf8');
console.log('fixtures listos');

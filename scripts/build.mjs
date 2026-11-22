/**
 * Build script for threejs-dxf-loader.
 *
 * Bundles the ES modules under src/dxf/ into:
 *   dist/threejs-dxf-loader.esm.js        ES module (three is an external peer)
 *   dist/threejs-dxf-loader.esm.min.js    minified ES module
 *   dist/threejs-dxf-loader.umd.js        UMD (browser global / CJS / AMD)
 *   dist/threejs-dxf-loader.umd.min.js    minified UMD
 *
 * Also copies the public type declarations and syncs the single-file example
 * viewer (examples/index.html) plus the GitHub Pages mirror (docs/).
 *
 * Author: zhangly1403 <zhangly1403@qq.com>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const entry = path.join(rootDir, 'src', 'dxf', 'index.js');
const distDir = path.join(rootDir, 'dist');
const typesDir = path.join(rootDir, 'types');
const examplesDir = path.join(rootDir, 'examples');
const docsDir = path.join(rootDir, 'docs');
const tmpDir = path.join(rootDir, '.build-tmp');

for (const d of [distDir, docsDir, tmpDir]) fs.mkdirSync(d, { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
const banner = `/*! threejs-dxf-loader v${pkg.version} | MIT | ${pkg.author.name} <${pkg.author.email}> */`;
const common = {
  entryPoints: [entry],
  bundle: true,
  external: ['three'],
  target: ['es2020'],
  banner: { js: banner },
  legalComments: 'none',
  logLevel: 'warning'
};

// ---------------------------------------------------------------------------
// 1. ES module builds
// ---------------------------------------------------------------------------
const esmOut = path.join(distDir, 'threejs-dxf-loader.esm.js');
await build({ ...common, format: 'esm', outfile: esmOut, sourcemap: true });
await build({ ...common, format: 'esm', minify: true, outfile: path.join(distDir, 'threejs-dxf-loader.esm.min.js'), sourcemap: true });
// `.mjs` mirror so Node's native ESM resolver can import the package through
// the "import" export condition (the package itself stays CommonJS).
fs.copyFileSync(esmOut, path.join(distDir, 'threejs-dxf-loader.esm.mjs'));

// ---------------------------------------------------------------------------
// 2. UMD builds: bundle to CJS (external three), then wrap in a UMD shell that
//    resolves THREE from the global scope for the browser <script> case.
// ---------------------------------------------------------------------------
const umdShell = (cjsBody) => `(function (root, factory) {
  if (typeof exports === 'object' && typeof module !== 'undefined') {
    var _three = null;
    try { _three = require('three'); } catch (_) {}
    module.exports = factory(_three || (root && root.THREE));
  } else if (typeof define === 'function' && define.amd) {
    define(['three'], factory);
  } else {
    var g = root || (typeof globalThis !== 'undefined' ? globalThis : window);
    g.DXFLoader = factory(g.THREE);
    if (g.THREE && !g.THREE.DXFLoader) g.THREE.DXFLoader = g.DXFLoader;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (THREE) {
  'use strict';
  if (!THREE && typeof window !== 'undefined' && window.THREE) THREE = window.THREE;
  var module = { exports: {} };
  var exports = module.exports;
  var require = function (name) {
    if (name === 'three') return THREE;
    throw new Error('threejs-dxf-loader: cannot resolve module "' + name + '"');
  };
${cjsBody}
  return module.exports.DXFLoader || module.exports.default || module.exports;
});
`;

const cjsOut = path.join(tmpDir, 'bundle.cjs');
await build({ ...common, format: 'cjs', outfile: cjsOut });
const umd = `${banner}\n${umdShell(fs.readFileSync(cjsOut, 'utf-8').trim())}`;
fs.writeFileSync(path.join(distDir, 'threejs-dxf-loader.umd.js'), umd, 'utf-8');

await build({ ...common, format: 'cjs', minify: true, outfile: cjsOut });
const umdMin = `${banner}\n${umdShell(fs.readFileSync(cjsOut, 'utf-8').trim())}`;
fs.writeFileSync(path.join(distDir, 'threejs-dxf-loader.umd.min.js'), umdMin, 'utf-8');

fs.rmSync(tmpDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 3. Types
// ---------------------------------------------------------------------------
const typesSrc = path.join(typesDir, 'DXFLoader.d.ts');
if (fs.existsSync(typesSrc)) {
  fs.copyFileSync(typesSrc, path.join(distDir, 'DXFLoader.d.ts'));
}

// ---------------------------------------------------------------------------
// 4. Sync the single-file example viewer + GitHub Pages mirror
// ---------------------------------------------------------------------------
const examplesHtmlPath = path.join(examplesDir, 'index.html');
if (fs.existsSync(examplesHtmlPath)) {
  let html = fs.readFileSync(examplesHtmlPath, 'utf-8');
  // Use a function replacer: the bundle contains many "$" (ACIS pointers); a
  // string replacement would treat $&, $1, $' etc. as special and corrupt HTML.
  const replaced = html.replace(
    /(<!--\s*Inline DXFLoader[\s\S]*?<script>\r?\n)[\s\S]*?(\r?\n\s*<\/script>)/,
    (_match, open, close) => open + umdMin.replace(/<\/script/gi, '<\\/script').replace(/\s+$/, '') + close
  );
  if (replaced === html) {
    console.warn('[build] Warning: could not locate inline DXFLoader script block in examples/index.html');
  } else {
    html = replaced;
    fs.writeFileSync(examplesHtmlPath, html, 'utf-8');
  }
  fs.writeFileSync(path.join(docsDir, 'index.html'), html, 'utf-8');
}

const samplesSrc = path.join(examplesDir, 'samples');
if (fs.existsSync(samplesSrc)) {
  const samplesDst = path.join(docsDir, 'samples');
  fs.mkdirSync(samplesDst, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(samplesSrc)) {
    if (!f.toLowerCase().endsWith('.dxf')) continue;
    fs.copyFileSync(path.join(samplesSrc, f), path.join(samplesDst, f));
    copied++;
  }
  console.log(`[build] copied ${copied} sample drawing(s) -> docs/samples/`);
}

const size = (f) => `${(fs.statSync(path.join(distDir, f)).size / 1024).toFixed(1)} kB`;
console.log(`[build] umd ${size('threejs-dxf-loader.umd.js')} | umd.min ${size('threejs-dxf-loader.umd.min.js')} | esm ${size('threejs-dxf-loader.esm.js')} | esm.min ${size('threejs-dxf-loader.esm.min.js')}`);
console.log('[build] Build completed successfully -> dist/ & docs/');

/**
 * Zero-dependency build script for threejs-dxf-loader
 * Generates dist/threejs-dxf-loader.umd.js, dist/threejs-dxf-loader.esm.js, and syncs docs/ for GitHub Pages.
 * Author: zhangly1403 <zhangly1403@qq.com>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const srcPath = path.join(rootDir, 'src', 'DXFLoader.js');
const distDir = path.join(rootDir, 'dist');
const examplesDir = path.join(rootDir, 'examples');
const docsDir = path.join(rootDir, 'docs');

fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(docsDir, { recursive: true });

const umdSource = fs.readFileSync(srcPath, 'utf-8');
fs.writeFileSync(path.join(distDir, 'threejs-dxf-loader.umd.js'), umdSource, 'utf-8');

const esmBundle = `/**
 * @license MIT
 * threejs-dxf-loader v1.1.0 (ES Module Bundle)
 * Author: zhangly1403 <zhangly1403@qq.com>
 */
import * as THREE from 'three';

const _globalScope = { THREE };
(function(root) {
${umdSource}
})(_globalScope);

export const DXFLoader = _globalScope.DXFLoader || THREE.DXFLoader;
export const DXFParser = DXFLoader.DXFParser;
export const MultiPageTextAtlas = DXFLoader.MultiPageTextAtlas;
export const ACI_PALETTE = DXFLoader.ACI_PALETTE;
export default DXFLoader;
`;
fs.writeFileSync(path.join(distDir, 'threejs-dxf-loader.esm.js'), esmBundle, 'utf-8');

// Sync inline DXFLoader inside examples/index.html from src, then copy to docs/
const examplesHtmlPath = path.join(examplesDir, 'index.html');
if (fs.existsSync(examplesHtmlPath)) {
  let html = fs.readFileSync(examplesHtmlPath, 'utf-8');
  // Use a function replacer: umdSource contains many "$" (ACIS pointers); a string
  // replacement would treat $&, $1, $' etc. as special and corrupt the HTML.
  const replaced = html.replace(
    /(<!--\s*Inline DXFLoader[\s\S]*?<script>\r?\n)[\s\S]*?(\r?\n\s*<\/script>)/,
    (_match, open, close) => open + umdSource.replace(/<\/script/gi, '<\\/script') + close
  );
  if (replaced === html) {
    console.warn('[threejs-dxf-loader] Warning: could not locate inline DXFLoader script block in examples/index.html');
  } else {
    html = replaced;
    fs.writeFileSync(examplesHtmlPath, html, 'utf-8');
  }
  fs.writeFileSync(path.join(docsDir, 'index.html'), html, 'utf-8');
}
console.log('[threejs-dxf-loader] Build completed successfully -> dist/ & docs/');

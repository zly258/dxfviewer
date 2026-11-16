/**
 * Zero-dependency build script for three-dxf-loader
 * Generates dist/three-dxf-loader.umd.js, dist/three-dxf-loader.esm.js, and syncs docs/ for GitHub Pages.
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
fs.writeFileSync(path.join(distDir, 'three-dxf-loader.umd.js'), umdSource, 'utf-8');

const esmBundle = `/**
 * @license MIT
 * three-dxf-loader v1.0.0 (ES Module Bundle)
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
fs.writeFileSync(path.join(distDir, 'three-dxf-loader.esm.js'), esmBundle, 'utf-8');

// Copy examples/index.html to docs/index.html for GitHub Pages deployment
if (fs.existsSync(path.join(examplesDir, 'index.html'))) {
  fs.copyFileSync(path.join(examplesDir, 'index.html'), path.join(docsDir, 'index.html'));
}
console.log('[three-dxf-loader] Build completed successfully -> dist/ & docs/');

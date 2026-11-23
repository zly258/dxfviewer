/**
 * @license GPL-3.0
 * threejs-dxf-loader - public ES module entry point.
 *
 * Named exports are tree-shakeable: importing only the parser does not pull in
 * the renderer, the text atlas or the ACIS reconstructor.
 */
import { DXFLoader } from './07-loader.js';
import { DXFParser } from './05-parser.js';
import { MultiPageTextAtlas } from './04-text.js';
import { LayerBatchCollector } from './06-batch.js';
import { PickIndex } from './08-pick.js';
import { ACI_PALETTE, Float32GrowableBuffer } from './00-util.js';

export { DXFLoader, DXFParser, MultiPageTextAtlas, LayerBatchCollector, PickIndex, ACI_PALETTE, Float32GrowableBuffer };

// Static helpers kept as top-level named exports for convenience.
export const {
  applyBackgroundTheme,
  decodeAcisData,
  decodeDXFArrayBuffer,
  mapCADFontToSystemFont,
  sabBytesToSatLines,
  resolveAcisSatLines
} = DXFLoader;

export default DXFLoader;
